/**
 * Guards UI state against responses from an older request or an unmounted
 * component. Starting a request invalidates every earlier version.
 */
export declare function useRequestVersion(): {
    begin: () => number;
    isCurrent: (version: number) => boolean;
};
