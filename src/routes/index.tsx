import { createFileRoute } from '@tanstack/react-router';
import { MarketingHome } from '~/features/marketing/components/MarketingHome';
import { getAppName } from '~/lib/utils';

export const Route = createFileRoute('/')({
  staticData: true,
  head: () => ({
    meta: [
      {
        title: `${getAppName()} — Home`,
      },
    ],
  }),
  component: MarketingHomeRoute,
});

function MarketingHomeRoute() {
  return <MarketingHome />;
}
