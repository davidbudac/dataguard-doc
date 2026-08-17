export { RefTable, byEdition } from './RefTable';
export type {
  PerEdition, RefCell, RefColumn, RefRow, RefTableData, RefValue,
} from './RefTable';
export { brokerProperties } from './broker-properties';
export { transportProperties } from './transport-properties';
export { clientParameters } from './client-parameters';
export { awrCapture } from './awr-capture';
export { changes26ai } from './changes-26ai';

import { brokerProperties } from './broker-properties';
import { transportProperties } from './transport-properties';
import { clientParameters } from './client-parameters';
import { awrCapture } from './awr-capture';
import { changes26ai } from './changes-26ai';
import type { RefTableData } from './RefTable';

/** Every reference table, for the tests and for the Reference lesson. */
export const REF_TABLES: RefTableData[] = [
  changes26ai, brokerProperties, transportProperties, clientParameters, awrCapture,
];
