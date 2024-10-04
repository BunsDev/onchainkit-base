import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { base } from 'viem/chains';
import { useAccount, useConnect, useSwitchChain } from 'wagmi';
import { useWaitForTransactionReceipt } from 'wagmi';
import { coinbaseWallet } from 'wagmi/connectors';
import { useWriteContracts } from 'wagmi/experimental';
import { useCallsStatus } from 'wagmi/experimental';
import { useValue } from '../../internal/hooks/useValue';
import { isUserRejectedRequestError } from '../../transaction/utils/isUserRejectedRequestError';
import { useIsWalletACoinbaseSmartWallet } from '../../wallet/hooks/useIsWalletACoinbaseSmartWallet';
import {
  GENERIC_ERROR_MESSAGE,
  NO_CONNECTED_ADDRESS_ERROR,
  NO_CONTRACTS_ERROR,
  USER_REJECTED_ERROR,
} from '../constants';
import {
  PAY_INSUFFICIENT_BALANCE_ERROR,
  PAY_INSUFFICIENT_BALANCE_ERROR_MESSAGE,
  PAY_LIFECYCLESTATUS,
  PayErrorCode,
} from '../constants';
import { useCommerceContracts } from '../hooks/useCommerceContracts';
import { useLifecycleStatus } from '../hooks/useLifecycleStatus';
import type { PayContextType, PayProviderReact } from '../types';

const emptyContext = {} as PayContextType;
export const PayContext = createContext<PayContextType>(emptyContext);

export function usePayContext() {
  const context = useContext(PayContext);
  if (context === emptyContext) {
    throw new Error('usePayContext must be used within a Pay component');
  }
  return context;
}

export function PayProvider({
  chargeHandler,
  children,
  onStatus,
  productId,
}: PayProviderReact) {
  // Core hooks
  const { address, chainId, isConnected } = useAccount();
  const { connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const [chargeId, setChargeId] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const isSmartWallet = useIsWalletACoinbaseSmartWallet();

  // Component lifecycle
  const { lifecycleStatus, updateLifecycleStatus } = useLifecycleStatus({
    statusName: PAY_LIFECYCLESTATUS.INIT,
    statusData: {},
  });

  // Transaction hooks
  const fetchContracts = useCommerceContracts({
    chargeHandler,
    productId,
  });

  const { status, writeContractsAsync } = useWriteContracts({
    /* v8 ignore start */
    mutation: {
      onSuccess: (id) => {
        setTransactionId(id);
      },
    },
    /* v8 ignore stop */
  });
  const { data } = useCallsStatus({
    id: transactionId,
    query: {
      /* v8 ignore next 3 */
      refetchInterval: (query) => {
        return query.state.data?.status === 'CONFIRMED' ? false : 1000;
      },
      enabled: !!transactionId,
    },
  });
  const transactionHash = data?.receipts?.[0]?.transactionHash;
  const { data: receipt } = useWaitForTransactionReceipt({
    hash: transactionHash,
  });

  // Component lifecycle emitters
  useEffect(() => {
    onStatus?.(lifecycleStatus);
  }, [
    lifecycleStatus,
    lifecycleStatus.statusData, // Keep statusData, so that the effect runs when it changes
    lifecycleStatus.statusName, // Keep statusName, so that the effect runs when it changes
    onStatus,
  ]);

  // Set transaction pending status when writeContracts is pending
  useEffect(() => {
    if (status === 'pending') {
      updateLifecycleStatus({
        statusName: PAY_LIFECYCLESTATUS.PENDING,
        statusData: {},
      });
    }
  }, [status, updateLifecycleStatus]);

  // Trigger success status when receipt is generated by useWaitForTransactionReceipt
  useEffect(() => {
    if (!receipt) {
      return;
    }
    updateLifecycleStatus({
      statusName: PAY_LIFECYCLESTATUS.SUCCESS,
      statusData: {
        transactionReceipts: [receipt],
        chargeId: chargeId,
        receiptUrl: `https://commerce.coinbase.com/pay/${chargeId}/receipt`,
      },
    });
  }, [chargeId, receipt, updateLifecycleStatus]);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO Refactor this component to deprecate funding flow
  const handleSubmit = useCallback(async () => {
    try {
      // Open Coinbase Commerce receipt
      if (lifecycleStatus.statusName === PAY_LIFECYCLESTATUS.SUCCESS) {
        window.open(
          `https://commerce.coinbase.com/pay/${chargeId}/receipt`,
          '_blank',
          'noopener,noreferrer',
        );
        return;
      }
      // Open funding flow
      // TODO: Deprecate this once we have USDC Magic Spend
      if (
        lifecycleStatus.statusName === PAY_LIFECYCLESTATUS.ERROR &&
        lifecycleStatus.statusData?.code === PayErrorCode.INSUFFICIENT_BALANCE
      ) {
        window.open(
          'https://keys.coinbase.com/fund',
          '_blank',
          'noopener,noreferrer',
        );
        return;
      }

      let connectedAddress = address;
      let connectedChainId = chainId;
      if (!isConnected || !isSmartWallet) {
        // Prompt for wallet connection
        // This is defaulted to Coinbase Smart Wallet
        const { accounts, chainId: _connectedChainId } = await connectAsync({
          connector: coinbaseWallet({ preference: 'smartWalletOnly' }),
        });
        connectedAddress = accounts[0];
        connectedChainId = _connectedChainId;
      }

      // This shouldn't ever happen, but to make Typescript happy
      /* v8 ignore start */
      if (!connectedAddress) {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
        updateLifecycleStatus({
          statusName: PAY_LIFECYCLESTATUS.ERROR,
          statusData: {
            code: PayErrorCode.UNEXPECTED_ERROR,
            error: NO_CONNECTED_ADDRESS_ERROR,
            message: NO_CONNECTED_ADDRESS_ERROR,
          },
        });
        return;
      }
      /* v8 ignore stop */

      // Fetch contracts
      const {
        contracts,
        chargeId: hydratedChargeId,
        insufficientBalance,
        priceInUSDC,
        error,
      } = await fetchContracts(connectedAddress);
      if (error) {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
        updateLifecycleStatus({
          statusName: PAY_LIFECYCLESTATUS.ERROR,
          statusData: {
            code: PayErrorCode.UNEXPECTED_ERROR,
            error: (error as Error).name,
            message: (error as Error).message,
          },
        });
        return;
      }
      setChargeId(hydratedChargeId);

      // Switch chain, if applicable
      if (connectedChainId !== base.id) {
        await switchChainAsync({ chainId: base.id });
      }

      // Check for sufficient balance
      if (insufficientBalance && priceInUSDC) {
        setErrorMessage(PAY_INSUFFICIENT_BALANCE_ERROR_MESSAGE(priceInUSDC));
        updateLifecycleStatus({
          statusName: PAY_LIFECYCLESTATUS.ERROR,
          statusData: {
            code: PayErrorCode.INSUFFICIENT_BALANCE,
            error: PAY_INSUFFICIENT_BALANCE_ERROR,
            message: PAY_INSUFFICIENT_BALANCE_ERROR_MESSAGE(priceInUSDC),
          },
        });
        return;
      }

      // Contracts weren't successfully fetched from `fetchContracts`
      if (!contracts || contracts.length === 0) {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
        updateLifecycleStatus({
          statusName: PAY_LIFECYCLESTATUS.ERROR,
          statusData: {
            code: PayErrorCode.UNEXPECTED_ERROR,
            error: NO_CONTRACTS_ERROR,
            message: NO_CONTRACTS_ERROR,
          },
        });
        return;
      }

      // Open keys.coinbase.com for payment
      await writeContractsAsync({
        contracts,
      });
    } catch (error) {
      const isUserRejectedError =
        (error as Error).message?.includes('User denied connection request') ||
        isUserRejectedRequestError(error);
      const errorCode = isUserRejectedError
        ? PayErrorCode.USER_REJECTED_ERROR
        : PayErrorCode.UNEXPECTED_ERROR;
      const errorMessage = isUserRejectedError
        ? USER_REJECTED_ERROR
        : GENERIC_ERROR_MESSAGE;

      setErrorMessage(errorMessage);
      updateLifecycleStatus({
        statusName: PAY_LIFECYCLESTATUS.ERROR,
        statusData: {
          code: errorCode,
          error: JSON.stringify(error),
          message: errorMessage,
        },
      });
    }
  }, [
    address,
    chainId,
    chargeId,
    connectAsync,
    fetchContracts,
    isConnected,
    isSmartWallet,
    lifecycleStatus.statusData,
    lifecycleStatus.statusName,
    switchChainAsync,
    updateLifecycleStatus,
    writeContractsAsync,
  ]);

  const value = useValue({
    errorMessage,
    lifecycleStatus,
    onSubmit: handleSubmit,
    updateLifecycleStatus,
  });
  return <PayContext.Provider value={value}>{children}</PayContext.Provider>;
}
