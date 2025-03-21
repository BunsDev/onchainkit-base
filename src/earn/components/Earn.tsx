import { Tab, TabContent, Tabs, TabsList } from '@/internal';
import { border, cn } from '@/styles/theme';
import type { EarnReact } from '../types';
import { EarnDeposit } from './EarnDeposit';
import { EarnProvider } from './EarnProvider';
import { EarnWithdraw } from './EarnWithdraw';

export function Earn({
  children = <EarnDefaultContent />,
  className,
  vaultAddress,
}: EarnReact) {
  return (
    <EarnProvider vaultAddress={vaultAddress}>
      <div
        className={cn(
          'flex w-[375px] flex-col overflow-hidden',
          border.radius,
          border.lineDefault,
          className,
        )}
      >
        {children}
      </div>
    </EarnProvider>
  );
}

function EarnDefaultContent() {
  return (
    <Tabs defaultValue="deposit">
      <TabsList>
        <Tab value="deposit">Deposit</Tab>
        <Tab value="withdraw">Withdraw</Tab>
      </TabsList>
      <TabContent
        value="deposit"
        className={cn(
          border.lineDefault,
          '!border-l-0 !border-b-0 !border-r-0',
        )}
      >
        <EarnDeposit />
      </TabContent>
      <TabContent
        value="withdraw"
        className={cn(
          border.lineDefault,
          '!border-l-0 !border-b-0 !border-r-0',
        )}
      >
        <EarnWithdraw />
      </TabContent>
    </Tabs>
  );
}
