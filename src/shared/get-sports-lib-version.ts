export interface PackageJsonVersion {
    version: string;
}

export function getSportsLibVersion(loadPackageJson: () => PackageJsonVersion): string {
    return loadPackageJson().version;
}
