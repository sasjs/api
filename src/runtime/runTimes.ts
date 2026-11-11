/**
 * The run times the published document states.
 *
 * The vocabulary is the document's, not a host's: `_program=/app/run.py` names
 * Python wherever it is read, and a host that cannot run Python says so when it is
 * asked to - it does not get to say the name means something else. Kept in its own
 * module so the runtime service and `resolveProgram` read one list rather than two
 * copies of it.
 */
export const DOCUMENTED_RUN_TIMES = ['sas', 'js', 'py', 'r', 'sasviya']
