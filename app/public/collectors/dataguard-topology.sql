-- Data Guard topology collector v1, Oracle 19c+. Read-only.
-- Run in SQL*Plus or SQLcl, connected to CDB$ROOT (or a non-CDB), once per
-- database / far sync member. GV$ views include all running RAC instances.
-- Spool outside this script; paste all complete blocks into Import existing setup.
-- Needs SELECT on V_$DATABASE, GV_$INSTANCE, V_$DATAGUARD_CONFIG,
-- GV_$ARCHIVE_DEST and V_$DATAGUARD_STATS. No application tables are read.
-- On a mounted standby/far sync, use an appropriately authorized connection.
whenever sqlerror exit failure rollback
whenever oserror exit failure rollback
set echo off feedback off heading off pagesize 0 verify off
set linesize 32767 trimspool on tab off define off
set long 1000000 longchunksize 32767
set recsep off
column payload format a4000
prompt DGTOPO_BEGIN_V1
select json_object(
  'type' value 'database', 'name' value db_unique_name,
  'role' value database_role, 'openMode' value open_mode,
  'protection' value protection_mode, 'flashback' value flashback_on,
  'fsfo' value fs_failover_mode, 'target' value fs_failover_current_target,
  'threshold' value fs_failover_threshold,
  'observerHost' value fs_failover_observer_host,
  'observerPresent' value fs_failover_observer_present,
  'collectedAt' value to_char(systimestamp, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
  'cdb' value cdb, 'container' value sys_context('USERENV', 'CON_NAME')
  returning varchar2(4000)) payload from v$database;
select json_object('type' value 'instance', 'name' value instance_name,
  'host' value host_name, 'version' value version_full
  returning varchar2(4000)) payload from gv$instance order by inst_id;
select json_object('type' value 'member', 'name' value db_unique_name,
  'role' value dest_role, 'parent' value parent_dbun
  returning varchar2(4000)) payload from v$dataguard_config order by db_unique_name;
select json_object('type' value 'destination', 'instance' value inst_id,
  'destId' value dest_id, 'target' value db_unique_name,
  'service' value destination, 'status' value status,
  'validNow' value valid_now, 'validRole' value valid_role,
  'transmit' value transmit_mode, 'affirm' value affirm,
  'netTimeout' value net_timeout, 'reopen' value reopen_secs,
  'maxFailure' value max_failure, 'alternate' value alternate,
  'error' value error
  returning varchar2(4000)) payload from gv$archive_dest
  where target in ('STANDBY', 'REMOTE') and status <> 'INACTIVE'
  order by inst_id, dest_id;
select json_object('type' value 'lag', 'name' value name, 'value' value value,
  'timeComputed' value time_computed, 'datumTime' value datum_time
  returning varchar2(4000)) payload from v$dataguard_stats
  where name in ('apply lag', 'transport lag');
prompt DGTOPO_END_V1
