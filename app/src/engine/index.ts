/**
 * The engine's public surface.
 *
 * Everything here is pure: no DOM, no I/O, no clock, no Math.random. The UI
 * layer imports from this module and nothing deeper.
 */

/* identity and units */
export * from './ids';

/* accuracy labelling */
export type {
  Basis, Claim, Finding, FindingFix, FindingSubject, JsonPatch, JsonPatchOp,
  Severity, SubjectKind,
} from './types/claims';
export {
  claimWellFormed, compareFindings, conflict, docLater, documented, inferred,
  mapClaim, model, NEEDS_NOTE, sortFindings,
} from './types/claims';

/* citations */
export type { Citation, CitationId, CitationVerification, DocEdition, ForbiddenFact } from './citations';
export { assertCitesAllowed, citation, CITATION_IDS, CITATIONS, FORBIDDEN_FACTS, isCitationId } from './citations';

/* topology */
export type {
  Application, ClientAddress, ClientDescriptor, Configuration, DatabaseMember, DbRole, DestGroup,
  DestProps, EnvironmentParams, FarSyncMember, FsfoConfig, FsfoState, FsfoTarget, Host,
  Instance, LagType, Link, LinkScope, Member, MemberBase, MemberKind, Observer, OpenMode,
  PreferredObserverHost, ProtectionMode, RedoRouteRule, RouteAlternate, RouteDest,
  RoutePriority, ServiceDef, Site, TopologyDoc, XptMode,
} from './types/topology';
export {
  declaredPrimary, destProps, findHost, findLink, findMember, findObserver, findSite,
  isDatabase, isFarSync, isRac, memberHosts,
} from './types/topology';

export { primarySite, withApplication } from './application';

/* events and states */
export type {
  AnyState, EventBody, EventKind, FarSyncState, MemberState, ObserverState, TimedEvent,
} from './types/events';
export { eventPriority, sortEvents } from './types/events';

/* derived output */
export type {
  Axis, Decision, DerivedFacts, EdgeInactiveReason, EdgeRole, Epoch, InternalDeadline,
  InternalDeadlineKind, Lane, NetStateSummary, Outcome, PerMemberFacts, ProtectionLevel,
  RedoEdge, RedoGraph, ResolvedMember, Segment, SimParams, Snapshot, Trace,
} from './types/trace';

/* bounds and broker defaults */
export type { Bound, BoundKey, BrokerDefaults } from './defaults';
export {
  BOUNDS, boundOf, BROKER_DEFAULTS, clamp, defaultLagLimit, NOMINAL, pingSet, withinBounds,
} from './defaults';
export { LAG_LIMIT_UNSET_STORED, lagLimitIsSet, lagLimitOf } from './defaults';

/* serialization */
export type { IssueSeverity, ParseResult, SchemaIssue } from './serialize/schema';
export {
  defaultClient, defaultConfiguration, defaultDestProps, defaultEnvironment, defaultFsfo,
  emptyDoc, isTopologyDoc, parseTopologyDoc, parseTopologyDocOrThrow,
} from './serialize/schema';
export type {
  LegacyConfigV1, LegacyDeploymentV1, LegacyParamsV1, LegacySimV1, MigrationResult,
  MigrationSource,
} from './serialize/migrate';
export {
  isLegacyV1, knobsToLegacyQuery, legacyQueryToKnobs, legacyToKnobs, LEGACY_URL_FIELDS,
  migrate, migrateLegacyQuery, migrateV1, parseQuery,
} from './serialize/migrate';
export type { DecodedPayload, PayloadKind } from './serialize/url';
export {
  base64UrlDecode, base64UrlEncode, decodePayload, deflateRaw, encodePayload,
  encodePayloadPlain, hasCompression, inflateRaw, payloadKind, utf8Decode, utf8Encode,
} from './serialize/url';

/* network */
export type { NetState, Reachability, ReachabilityOptions } from './net/graph';
export {
  applyNetEvent, buildReachability, emptyNetState, expandLinks, hostUp, initialNetState,
  instanceKey, linkRttMs, liveInstanceHosts, liveInstances, memberAlive, memberDegraded,
  memberReachableFromHost, membersReachable, netFromSummary, netSummary, reachable,
  stoppedInstances, upHosts,
} from './net/graph';

/* redo routing */
export type {
  FormatOptions, RedoRoutesDialect, RedoRoutesParseError, RedoRoutesParseResult,
} from './redo/parse';
export {
  formatRedoRoutes, formatRedoRule, isParenthesised, parseRedoRoutes, parseRedoRoutesOrThrow,
} from './redo/parse';
export type { ResolveOptions } from './redo/resolve';
export {
  activeRule, defaultDestPriority, destKey, expandAll, groupKey, resolveRedoGraph,
} from './redo/resolve';

/* axes */
export type { AxisSpec, CommitAxisSpec } from './models/axis';
export {
  cmTickStep, commitAxis, failoverAxis, fixedAxis, pickTickStep, preRollFor, reopenAxis,
  rpTickStep, secondsAxis,
} from './models/axis';

/* the other three models: the application's view, one commit, the reopen ladder */
export type {
  AddressPlan, AppAttempt, AppClaims, AppModel, AppOptions, AppSpan, Dial, DialKind, NoEventKind,
} from './models/app';
export { computeApp } from './models/app';
export type {
  CommitClaims, CommitInput, CommitLeg, CommitLegResult, CommitModel, CommitWaitPolicy,
} from './models/commit';
export { computeCommit } from './models/commit';
export type {
  ReopenAttempt, ReopenClaims, ReopenFromOptions, ReopenInput, ReopenModel,
} from './models/reopen';
export { computeReopen, outageFromTrace, reopenInputFrom } from './models/reopen';

/* config generators */
export type {
  FileSyntax, GeneratedFile, Line, LineKind, LineOptions, LineTone, Span,
} from './generate/lines';
export {
  blank, cmd, comment, commentMarker, commentText, dim, hl, lineText, note, renderPlain, span, svc,
} from './generate/lines';
export { buildTns, serviceAddresses } from './generate/tnsnames';
export type { JdbcOptions } from './generate/jdbc';
export { buildJdbc } from './generate/jdbc';
export type { DgmgrlOptions } from './generate/dgmgrl';
export { generateDgmgrl } from './generate/dgmgrl';
export type { InitOraOptions } from './generate/initora';
export { generateInitOra, generateInitOraFiles, generateRacParameters } from './generate/initora';
export type { ShowConfigurationOptions } from './generate/show';
export {
  generateShowMocks, showConfiguration, showDatabase, showFastStartFailover, showObserver,
} from './generate/show';

/* simulation */
export type {
  Conditions, DataLossKind, EngineFacts, EngineTrace, LagStall,
} from './sim/simulate';
export { simulate, stateAt } from './sim/simulate';
export type { DeadlineAction, Pending, Phase, Sample, SimState, SwitchoverFacts } from './sim/kernel';
export { buildLanes, epochAt, EPS, Queue, segmentAt, snapshotFrom } from './sim/kernel';
export type { Readiness, TargetChoice } from './sim/fsfo';
export {
  applyLagOf, candidateTargets, detectClaim, directRedoClaim, effectiveLagType, gateLagSeconds,
  initiateDelayClaim, lagGated, nominationClaim, pickMaster, pingPropertiesSet,
  preferredHostsClaim, preferredRank, readinessGate, selectTarget, targetKindClaim,
  transportLagOf,
} from './sim/fsfo';
export { noSecondTarget, notReadyClaim, pingInEffect, pingNotIn19c, resyncClaim } from './sim/fsfo';
export {
  abortClaim, commitHangClaim, maxAvailDegraded, maxProtectionShutdown, modeName,
  netTimeoutForMode, netTimeoutOf, stallClaim, syncAckDatabases, syncAckMembers,
} from './sim/protection';
export { honestLevel, modeAfterFailover, noStallClaim } from './sim/protection';
export type { ManualFailoverInput, SwitchoverGateInput, SwitchoverRefusal } from './sim/roles';
export { bystanderAhead, manualLossClaim, reinstateCommandFindings } from './sim/roles';
export {
  applyFailoverClaim, applyInstanceTimeout, applyParticipants, hasApplyInstance,
  initialApplyInstance, isMultiInstanceApply, nextApplyInstance, primaryDegradedClaim,
} from './sim/rac';
export {
  bystanderClaim, bystanders, executionClaim, manualFailoverFindings, nominalBandsClaim,
  reinstateBandClaim, reinstateFindings, SW_CONVERT, SW_VERIFY, switchoverGate,
  switchoverLossClaim, switchoverRefused, switchoverSchedule,
} from './sim/roles';
export type { AuthoredDest } from './sim/dests';
export { authoredDests, retryLimit } from './sim/dests';

/* validation */
export type { DeclaredDest, Rule, RuleId, RuleSpec, ValidateContext } from './validate';
export {
  allowedBases, allowedSeverities, buildContext, RULE_CATALOGUE, RULE_IDS, RULES,
  RULES_26AI_ONLY, ruleSpec, validate, validateWithContext,
} from './validate';

/* backward compatibility with the published 1+1+1 workbench */
export type { ClassicKnobs, ClassicMode, ClassicObserverLoc, ClassicScenario } from './compat/classic';
export type { LegacyModel } from './compat/classic';
export {
  CLASSIC_DEFAULTS, CLASSIC_IDS, classicTopology, effectiveScenario, legacyComputeFsfo,
  scenarioEvents, toLegacyModel,
} from './compat/classic';
export { PUBLISHED_PAGE } from './compat/classic';

export { importCollectedTopology, COLLECTION_LIMIT, COLLECTION_NOTE } from './collect';
export type { CollectedTopology } from './collect';
