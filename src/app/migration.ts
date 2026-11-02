/** Standalone databases deliberately do not import DSH session state. */
export const SCHEMA_VERSION = 100
export const OLDEST_SCHEMA = 100
export const tooOld = (version:number) => `Database schema ${version} belongs to an earlier application. Choose a new state directory; DSH data is not migrated.`
