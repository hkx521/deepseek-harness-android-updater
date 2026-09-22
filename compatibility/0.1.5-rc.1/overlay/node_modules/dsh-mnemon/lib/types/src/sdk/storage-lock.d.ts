/**
 * Serialize in-process work on one local storage root, including work from
 * independently loaded plugins. File locks still own cross-process safety.
 * Callers must not acquire the same root recursively.
 */
export declare function withMemoryStorageLock<T>(directory: string, operation: () => T | Promise<T>): Promise<T>;
