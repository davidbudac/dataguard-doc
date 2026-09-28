IMPORT AN EXISTING DATA GUARD TOPOLOGY

Quick start
  1. On each database / far sync, from CDB$ROOT, as SYSDBA:
       sqlplus -s / as sysdba @dataguard-topology.sql </dev/null > <member>.txt
     (or: bash collect-dataguard.sh > <member>.txt)
  2. Combine:  cat primary.txt standby.txt > topology.txt
  3. Workbench: ... menu -> Import existing setup -> load or paste
     topology.txt -> Preview import -> Draw imported topology.
  Each file holds one DGTOPO_BEGIN_V1 ... DGTOPO_END_V1 block of JSON lines.
  Undo restores the previous drawing. Details and limits follow.

This collector targets Oracle 19c+ using documented dynamic views. It reads
metadata only: no ALTER, broker changes, database links, application-table scans,
password collection or server-side files. Output contains infrastructure names.

SQL*Plus / SQLcl
  Connect using your normal authorized connection. For a CDB use CDB$ROOT,
  not a PDB. A mounted standby or far sync may require an administrative
  connection. Collect once per database / far sync; GV$ includes running RAC
  instances, so do not collect a second block for every RAC instance.

  spool member.txt
  @dataguard-topology.sql
  spool off

Required SELECT access to these fixed views (grants use the underscore names):
  V_$DATABASE, GV_$INSTANCE, V_$DATAGUARD_CONFIG, GV_$ARCHIVE_DEST,
  V_$DATAGUARD_STATS.
Use an existing authorized account; the script grants no privileges. Run it in
a dedicated session: WHENEVER SQLERROR exits on a query error. Do not run it in
a session holding uncommitted application work. The script changes client
formatting settings. It emits one JSON record per line between versioned markers.
Do not use a grid export or wrap the output. Retain both markers.

Collect all members close together, with no role change in progress. Concatenate
or paste the complete blocks together. Do not combine different configurations
or repeat a member. The importer lists missing members instead of inventing them.
No special shell is needed for this workflow.

Optional Bash wrapper (requires SQL*Plus)
  Keep collect-dataguard.sh and dataguard-topology.sql in the same directory.
  Local OS authentication:
    bash collect-dataguard.sh > member.txt
  Wallet aliases for all members:
    bash collect-dataguard.sh PRIMARY_ALIAS STANDBY_ALIAS FARSYNC_ALIAS > topology.txt

Aliases must already work with SQL*Plus wallet authentication and have the
necessary privileges. Do not pass passwords. The wrapper buffers output and
returns a failure without releasing partial output if SQL*Plus fails, reports
a client error, omits completion markers, or a connection takes longer than
DG_COLLECT_TIMEOUT seconds (default 120; needs the timeout command, and an alias
that does not resolve can otherwise hang). Diagnostics go to stderr. It does
not discover credentials or connect remotely by SSH. Without a wallet, use
SQL*Plus interactively on each member. The wrapper runs the same SQL; it does
not enrich it with broker data.

In the workbench
  Open the top bar's ... menu -> Import existing setup.
  Paste the combined output, or load its text file (maximum 2 MB of UTF-8). Select Preview import.
  Review the members and assumptions, then Draw imported topology.
  The prior document is recoverable through Undo and Saved configurations.
  Export/share/reload keep the assumption summary in document notes.
  Everything is processed locally in the browser; nothing is uploaded.

What is mapped
  Database unique names and roles (including far sync), running instances and
  hosts, primary protection mode, flashback, open modes, current VALID remote
  destinations with VALID_NOW=YES, transport/affirm and destination timeout,
  reopen and failure settings; standby apply/transport lag where available;
  primary FSFO mode, threshold, current target and master-observer host.
  Matching RAC destinations collapse to one edge. Conflicting definitions fail.
  Failed/deferred/alternate-status/not-current destinations are reported but
  not drawn as current working routes. A VALID current destination that names
  an alternate is retained; the fallback relationship is reported as unknown. Out-of-range simulator values are adjusted and
  listed in the preview. Lag is a sample, not a guarantee of freshness.

What remains unknown / needs review
  SQL does not recover all broker configuration. In particular this format does
  not collect RedoRoutes, future-primary routes, priorities, complete potential
  targets, backup observers, ObserverOverride, lag/ping policies or all broker
  properties. For a broker-managed setup use DGMGRL to review:
    SHOW CONFIGURATION VERBOSE;
    SHOW DATABASE VERBOSE '<each database unique name>';
    SHOW FAR_SYNC VERBOSE '<each far sync name>';
    SHOW FAST_START FAILOVER;
    SHOW OBSERVER;
  DGMGRL transcripts are reference material, not an accepted import format yet.
  A future broker-enriched collector can share this import UI; it should use a
  versioned structured format instead of relying on localized text parsing.

  Physical data centres, latency, firewall reachability, listener ports, client
  descriptors/services, apply state, static services, I/O times and execution
  duration are not discovered. The drawing uses provisional host-based sites,
  all-to-all assumed connectivity at 0 ms, listener port 1521 and simulator
  defaults. RAC instances on separate hosts need their site/cluster reviewed.
  Only running RAC instances appear. A missing observer connection is not proof
  that its process stopped. No backup observer is synthesized. Unknown lag
  becomes a clearly reported 0 s placeholder. ObserverOverride is assumed FALSE.
  Current SQL routes are converted to drawing rules; they are not recovered
  broker RedoRoutes. No reverse routes are fabricated on a simulated role swap.
  Generated scripts must be reviewed against the real broker configuration.

Validation status
  Automated parser, UI and engine tests cover the format and mapping. The SQL
  and the local/failing-alias wrapper paths were run on a 19.27 two-member test
  configuration (CDB primary, mounted physical standby, FSFO, SYSDBA OS
  authentication). Wallet authentication, least-privilege accounts, RAC, far
  sync, cascades and ASYNC routes are not yet verified live; validate the
  collector in your own test environment before relying on it operationally.

Oracle sources
  https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-DATABASE.html
  https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-DATAGUARD_CONFIG.html
  https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-ARCHIVE_DEST.html
  https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-INSTANCE.html
  https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-DATAGUARD_STATS.html
  https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-commands.html
