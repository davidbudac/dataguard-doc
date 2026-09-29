/**
 * The application: where it stands, and the connect string it dials with.
 *
 * Its parameters are the connect descriptor's -- the same `doc.client` the
 * generated `tnsnames.ora` entry and the JDBC URL are written from -- so a
 * value set here is the value in the generated string and in the ladder the
 * Break timeline draws. Three things this form keeps saying, because they are
 * the point of it: these parameters affect only NEW connections; the address
 * list is what the application can be sent to, not what it can reach (the
 * network decides that, from the data centre the card stands in); and the
 * dead-address answer is this page's switch, not an Oracle parameter.
 */

import type { Application, ClientDescriptor, TopologyDoc } from '@/engine';
import { CLIENT_TIMING_DEFAULTS, CLIENT_TIMING_TUNED, siteId } from '@/engine';
import { canEdit, viewport } from '@/state/view';
import { Check, Choice, Group, Note, Num, Pick, Text } from './controls';
import {
  applyClientTiming, clientHasTiming, moveToSite, patchClient, renameApplication, setAddressListed,
} from './edits';
import { off, ON, WHY } from './why';

export interface ApplicationFormProps {
  application: Application;
  doc: TopologyDoc;
}

/**
 * The four timing parameters, as the same controls wherever they are offered:
 * here in the rail and on the Simulate timeline's application strip
 * (`break/TimelineView.tsx`). One component, so a note or a bound changed in
 * one place is changed in both. The controls grey out where editing is not
 * allowed (`canEdit`), as the rest of the rail does.
 */
export function ClientTimingControls({ client: c }: { client: ClientDescriptor }) {
  const enabled = canEdit(viewport.value) ? ON : off(WHY.readOnlyView);
  return (
    <>
      <Num
        enabled={enabled}
        name="TRANSPORT_CONNECT_TIMEOUT"
        bound="transportConnectTimeoutSeconds"
        value={c.transportConnectTimeoutSeconds}
        coalesce="client:tct"
        onChange={(v) => patchClient(
          `Set TRANSPORT_CONNECT_TIMEOUT to ${v} s`,
          (x) => ({ ...x, transportConnectTimeoutSeconds: v }), 'client:tct',
        )}
        note="Default 60 s, for each ADDRESS and each IP address a host name is mapped to. This page draws one IP address per host. The JDBC thin driver does not inherit this default, so the generated URL always spells the value out."
      />
      <Num
        enabled={enabled}
        name="CONNECT_TIMEOUT"
        bound="connectTimeoutSeconds"
        value={c.connectTimeoutSeconds ?? 0}
        unit={c.connectTimeoutSeconds === null || c.connectTimeoutSeconds === 0 ? 's — not set' : 's'}
        coalesce="client:ct"
        onChange={(v) => patchClient(
          v > 0 ? `Set CONNECT_TIMEOUT to ${v} s` : 'Leave CONNECT_TIMEOUT unset',
          (x) => ({ ...x, connectTimeoutSeconds: v > 0 ? v : null }), 'client:ct',
        )}
        note="Per ADDRESS, and no default is documented: at 0 it is left out of the string. Set, the wait on one address is the smaller of the two timeouts."
      />
      <Num
        enabled={enabled}
        name="RETRY_COUNT"
        bound="retryCount"
        kind="number"
        value={c.retryCount}
        onChange={(v) => patchClient(
          `Set RETRY_COUNT to ${v}`, (x) => ({ ...x, retryCount: v }), 'client:rc',
        )}
        note="Extra traversals of the whole address list after the first one fails across all of it. The reference prints no default; one traversal when unset is this page's reading."
      />
      <Num
        enabled={enabled}
        name="RETRY_DELAY"
        bound="retryDelaySeconds"
        value={c.retryDelaySeconds}
        coalesce="client:rd"
        onChange={(v) => patchClient(
          `Set RETRY_DELAY to ${v} s`, (x) => ({ ...x, retryDelaySeconds: v }), 'client:rd',
        )}
        note="Seconds between traversals. No default is documented; at 0 the next traversal starts at once."
      />
    </>
  );
}

/**
 * Defaults and Tuned: the four timing parameters in one click and one undo
 * step. Pressed while the descriptor holds exactly that set. The tuned numbers
 * are this page's suggested shape (a short TRANSPORT_CONNECT_TIMEOUT, a
 * generous CONNECT_TIMEOUT, short delays times many retries), not figures
 * Oracle documents as a recommendation -- the tooltip says so.
 */
export function ClientPresets({ client: c }: { client: ClientDescriptor }) {
  const editable = canEdit(viewport.value);
  const T = CLIENT_TIMING_TUNED;
  return (
    <div class="client-presets" role="group" aria-label="Connect string presets">
      <button
        type="button" class="btn" disabled={!editable}
        aria-pressed={clientHasTiming(c, CLIENT_TIMING_DEFAULTS)}
        title="TRANSPORT_CONNECT_TIMEOUT 60 s, CONNECT_TIMEOUT not set, RETRY_COUNT 0, RETRY_DELAY 0 s: the parameters' own defaults"
        onClick={() => applyClientTiming('defaults')}
      >
        Defaults
      </button>
      <button
        type="button" class="btn" disabled={!editable}
        aria-pressed={clientHasTiming(c, T)}
        title={`TRANSPORT_CONNECT_TIMEOUT ${T.transportConnectTimeoutSeconds} s, CONNECT_TIMEOUT ${T.connectTimeoutSeconds} s, RETRY_COUNT ${T.retryCount}, RETRY_DELAY ${T.retryDelaySeconds} s: this page's suggested shape -- a short transport timeout, a generous CONNECT_TIMEOUT, short delays times many retries. The HA guide's example uses CONNECT_TIMEOUT=90; the rest are not Oracle figures.`}
        onClick={() => applyClientTiming('tuned')}
      >
        Tuned
      </button>
    </div>
  );
}

const DEAD = [
  { value: 'drop' as const, label: 'no answer' },
  { value: 'rst' as const, label: 'refused' },
];

export function ApplicationForm({ application, doc }: ApplicationFormProps) {
  const c = doc.client;
  const host = doc.hosts.find((h) => h.id === application.host);
  const listed = new Set(c.addresses.map((a) => a.host as string));
  const databases = doc.members.filter((m) => m.kind === 'database');
  const farSyncs = doc.members.filter((m) => m.kind === 'farsync');

  return (
    <>
      <Group title="General">
        <Text
          name="Name" prose
          value={application.id as string}
          onCommit={(v) => renameApplication(v)}
          focusKey={`name:${application.id as string}`}
          note="A label for the card. Nothing in the generated configuration carries it."
        />
        <Pick
          name="Data centre" prose
          value={(host?.site as string | undefined) ?? ''}
          options={doc.sites.map((s) => ({ value: s.id as string, label: s.name }))}
          onChange={(v) => moveToSite(application.id as string, siteId(v))}
          note="Where the connect string is dialled from. Inside one data centre every host is reached; across two, only over a link between them that is up. Dragging the card into another data centre does the same."
        />
        <Note>
          The application stands on a host of its own{host ? <> (<span class="mono">{host.name}</span>)</> : null}.
          It decides nothing about a failover: it is drawn to show what the failure costs it.
        </Note>
      </Group>

      <Group title="Connect string">
        <ClientPresets client={c} />
        <Text
          name="SERVICE_NAME"
          value={c.serviceName}
          onCommit={(v) => patchClient(
            `Set SERVICE_NAME to ${v.trim() || c.serviceName}`,
            (x) => ({ ...x, serviceName: v.trim() || x.serviceName }),
          )}
          note="The role-based service. A database that does not hold the primary role does not publish it, and its listener refuses the connection with ORA-12514."
        />
        <ClientTimingControls client={c} />
        <Check
          name="FAILOVER"
          label="Connect-time failover: try the next address when one fails"
          checked={c.failover}
          onChange={(v) => patchClient(
            `Set FAILOVER ${v ? 'on' : 'off'}`, (x) => ({ ...x, failover: v }),
          )}
          note="Default on. It is written into the generated string as set here; the ladder on this page is drawn with it on."
        />
        <Check
          name="LOAD_BALANCE"
          label="Progress through the addresses in a random order"
          checked={c.loadBalance}
          onChange={(v) => patchClient(
            `Set LOAD_BALANCE ${v ? 'on' : 'off'}`, (x) => ({ ...x, loadBalance: v }),
          )}
          note="Default off inside an ADDRESS_LIST. This page is deterministic and keeps the list order either way: with it on, the ladder is one of the orders the client could take."
        />
        <Note>
          These parameters affect only new connections. No established session is touched
          by anything set here.
        </Note>
      </Group>

      <Group title={`ADDRESS_LIST (${databases.filter((m) => m.instances.some((i) => listed.has(i.host as string))).length})`}>
        {databases.map((m) => (
          <Check
            key={m.id as string}
            name={m.id as string}
            label={`List ${m.name} in the ADDRESS_LIST`}
            checked={m.instances.some((i) => listed.has(i.host as string))}
            onChange={(v) => setAddressListed(m.id, v)}
          />
        ))}
        {farSyncs.map((m) => (
          <Check
            key={m.id as string}
            name={m.id as string}
            label={`${m.name} is a far sync instance`}
            checked={false}
            enabled={off(WHY.farSyncNotAddress)}
            onChange={() => undefined}
          />
        ))}
        <Note>
          Every database listed is a line on the drawing. The primary and every standby are
          listed to start with, so the string still finds the service after the role moves.
        </Note>
      </Group>

      <Group title="This page's model">
        <Choice
          name="A dead host's answer" prose
          value={c.deadBehaviour}
          options={DEAD}
          enabled={ON}
          onChange={(v) => patchClient(
            `Draw a dead host as ${v === 'drop' ? 'giving no answer' : 'refusing'}`,
            (x) => ({ ...x, deadBehaviour: v }),
          )}
          note="Not an Oracle parameter. With no answer the dial waits out the timeout; refused, the operating system answers at once. An address behind a severed link gives no answer either way: nobody is on the far side to refuse."
        />
      </Group>
    </>
  );
}
