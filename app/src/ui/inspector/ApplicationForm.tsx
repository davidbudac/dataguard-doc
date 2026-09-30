/**
 * One application: where it stands, and the connect string it dials with.
 *
 * Its parameters are the connect descriptor's it dials -- its own when it has
 * one, else the shared `doc.client` (the form says which, and who else dials
 * it: an edit to the shared one changes every application that uses it). The
 * generated `tnsnames.ora` entry and the JDBC URL are written from the same
 * descriptor, so a value set here is the value in the generated string and in
 * the ladder the Break timeline draws for this application. Three things this form keeps saying, because they are
 * the point of it: these parameters affect only NEW connections; the address
 * list is what the application can be sent to, not what it can reach (the
 * network decides that, from the data centre the card stands in); and the
 * dead-address answer is this page's switch, not an Oracle parameter.
 */

import type { Application, ClientDescriptor, TopologyDoc } from '@/engine';
import {
  applicationClient, applicationsOf, CLIENT_TIMING_DEFAULTS, CLIENT_TIMING_TUNED, siteId,
} from '@/engine';
import { canEdit, viewport } from '@/state/view';
import { CLIENT_TIMING_FIELDS, editClientTiming } from './client-timing';
import { Check, Choice, Group, Note, Num, Pick, Text } from './controls';
import {
  applyClientTiming, clientHasTiming, moveToSite, patchClient as patchClientEdit, renameApplication, setAddressListed, setOwnClient,
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
export function ClientTimingControls({ client: c, appId }: { client: ClientDescriptor; appId?: string }) {
  const enabled = canEdit(viewport.value) ? ON : off(WHY.readOnlyView);
  return (
    <>
      {CLIENT_TIMING_FIELDS.map((f) => (
        <Num
          key={f.name}
          enabled={enabled}
          name={f.name}
          bound={f.bound}
          kind={f.kind}
          value={f.value(c)}
          {...(f.unit === undefined ? {} : { unit: f.unit(c) })}
          coalesce={f.coalesce}
          onChange={(v) => editClientTiming(f, v, appId)}
          note={f.note}
        />
      ))}
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
export function ClientPresets({ client: c, appId, wrap }: {
  client: ClientDescriptor; appId?: string;
  /** How an edit is made: Simulate's column wraps it as a tuning edit (`tuned`), so the axis holds. */
  wrap?: (edit: () => void) => void;
}) {
  const run = (edit: () => void): void => (wrap === undefined ? edit() : wrap(edit));
  const editable = canEdit(viewport.value);
  const T = CLIENT_TIMING_TUNED;
  return (
    <div class="client-presets" role="group" aria-label="Connect string presets">
      <button
        type="button" class="btn" disabled={!editable}
        aria-pressed={clientHasTiming(c, CLIENT_TIMING_DEFAULTS)}
        title="TRANSPORT_CONNECT_TIMEOUT 60 s, CONNECT_TIMEOUT not set, RETRY_COUNT 0, RETRY_DELAY 0 s: the parameters' own defaults"
        onClick={() => run(() => applyClientTiming('defaults', appId))}
      >
        Defaults
      </button>
      <button
        type="button" class="btn" disabled={!editable}
        aria-pressed={clientHasTiming(c, T)}
        title={`TRANSPORT_CONNECT_TIMEOUT ${T.transportConnectTimeoutSeconds} s, CONNECT_TIMEOUT ${T.connectTimeoutSeconds} s, RETRY_COUNT ${T.retryCount}, RETRY_DELAY ${T.retryDelaySeconds} s: this page's suggested shape -- a short transport timeout, a generous CONNECT_TIMEOUT, short delays times many retries. The HA guide's example uses CONNECT_TIMEOUT=90; the rest are not Oracle figures.`}
        onClick={() => run(() => applyClientTiming('tuned', appId))}
      >
        Tuned
      </button>
    </div>
  );
}

const CONNECT_STRING = [
  { value: 'shared' as const, label: 'Use the shared connect string' },
  { value: 'own' as const, label: 'Own connect string' },
];

const DEAD = [
  { value: 'drop' as const, label: 'no answer' },
  { value: 'rst' as const, label: 'refused' },
];

export function ApplicationForm({ application, doc }: ApplicationFormProps) {
  const id = application.id as string;
  const c = applicationClient(doc, application);
  const own = application.client !== undefined;
  const others = applicationsOf(doc)
    .filter((a) => a.client === undefined && a.id !== application.id).map((a) => a.name);
  /* Every edit below is to the descriptor this application dials, and says so. */
  const patch = (
    label: string, fn: Parameters<typeof patchClientEdit>[1], key?: string,
  ): void => patchClientEdit(label, fn, key, id);
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
          onCommit={(v) => renameApplication(id, v)}
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
        <Choice
          name="Dials" prose
          value={own ? 'own' : 'shared'}
          options={CONNECT_STRING}
          enabled={ON}
          onChange={(v) => setOwnClient(id, v === 'own')}
          note={own
            ? 'This application dials a descriptor of its own: what is set below changes it and no other. Taking it back to the shared one discards these settings.'
            : `This application dials the document's shared descriptor, which is dialled by ${others.length === 0 ? 'no other application' : others.join(', ')}. What is set below changes it for all of them. Choosing an own connect string starts from a copy of it.`}
        />
        <ClientPresets client={c} appId={id} />
        <Text
          name="SERVICE_NAME"
          value={c.serviceName}
          onCommit={(v) => patch(
            `Set SERVICE_NAME to ${v.trim() || c.serviceName}`,
            (x) => ({ ...x, serviceName: v.trim() || x.serviceName }),
          )}
          note="The role-based service. A database that does not hold the primary role does not publish it, and its listener refuses the connection with ORA-12514."
        />
        <ClientTimingControls client={c} appId={id} />
        <Check
          name="FAILOVER"
          label="Connect-time failover: try the next address when one fails"
          checked={c.failover}
          onChange={(v) => patch(
            `Set FAILOVER ${v ? 'on' : 'off'}`, (x) => ({ ...x, failover: v }),
          )}
          note="Default on. It is written into the generated string as set here; the ladder on this page is drawn with it on."
        />
        <Check
          name="LOAD_BALANCE"
          label="Progress through the addresses in a random order"
          checked={c.loadBalance}
          onChange={(v) => patch(
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
            onChange={(v) => setAddressListed(id, m.id, v)}
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
          onChange={(v) => patch(
            `Draw a dead host as ${v === 'drop' ? 'giving no answer' : 'refusing'}`,
            (x) => ({ ...x, deadBehaviour: v }),
          )}
          note="Not an Oracle parameter. With no answer the dial waits out the timeout; refused, the operating system answers at once. An address behind a severed link gives no answer either way: nobody is on the far side to refuse."
        />
      </Group>
    </>
  );
}
