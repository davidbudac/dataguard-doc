/**
 * What the page is showing: the workbench, or the printable report in its
 * place (`?report=1`, ui/export/Report.tsx). The report replaces the whole
 * shell -- header included -- because on paper none of the shell is
 * information, and on screen the report brings its own way back.
 */

import { reportPage } from '@/state/view';
import { App } from './App';
import { Report } from './export/Report';

export function Root() {
  return reportPage.value ? <Report /> : <App />;
}
