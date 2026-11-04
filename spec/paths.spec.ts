/**
 * The path rules, which are the server's - so each case names the behaviour a
 * server already has rather than a preference of this package.
 */
import {
  basename,
  checkFilePath,
  dirname,
  hasBlockedExtension,
  isRoot,
  normaliseDrivePath
} from '../src/drive/paths.js'

describe('normaliseDrivePath', () => {
  it('treats a leading slash as the drive root, not the filesystem', () => {
    expect(normaliseDrivePath('/data/x.csv')).toBe('/data/x.csv')
    expect(normaliseDrivePath('data/x.csv')).toBe('/data/x.csv')
    // a Windows client sends separators the other way round (resolveWithinDrive
    // normalises them for the same reason)
    expect(normaliseDrivePath('data\\x.csv')).toBe('/data/x.csv')
  })

  it('takes an empty path to the root', () => {
    expect(normaliseDrivePath('')).toBe('/')
    expect(normaliseDrivePath(undefined)).toBe('/')
    expect(normaliseDrivePath(null)).toBe('/')
    expect(normaliseDrivePath('/')).toBe('/')
  })

  it('resolves a step up rather than refusing it', () => {
    expect(normaliseDrivePath('/data/../keep.csv')).toBe('/keep.csv')
    expect(normaliseDrivePath('/data/./x.csv')).toBe('/data/x.csv')
  })

  it('refuses a path that climbs past the root', () => {
    expect(normaliseDrivePath('/../escape.csv')).toBeNull()
    expect(normaliseDrivePath('/data/../../escape.csv')).toBeNull()
    expect(normaliseDrivePath('..')).toBeNull()
  })

  it('does not mistake a name that starts with dots for a step up', () => {
    // the server compares the first SEGMENT of the relative path, so '..foo' is
    // a name - a substring test would refuse it
    expect(normaliseDrivePath('/data/..foo.csv')).toBe('/data/..foo.csv')
  })
})

describe('hasBlockedExtension', () => {
  it('refuses the three the server refuses', () => {
    expect(hasBlockedExtension('/a/run.sh')).toBe(true)
    expect(hasBlockedExtension('/a/setup.exe')).toBe(true)
    expect(hasBlockedExtension('/a/.htaccess')).toBe(true)
    expect(hasBlockedExtension('/a/RUN.SH')).toBe(true)
  })

  it('allows everything else, including a name that only looks close', () => {
    expect(hasBlockedExtension('/a/run.sh.txt')).toBe(false)
    expect(hasBlockedExtension('/a/shell')).toBe(false)
  })
})

describe('checkFilePath', () => {
  it('answers with the path, or the reason it is refused', () => {
    expect(checkFilePath('/data/x.csv')).toEqual({ path: '/data/x.csv' })
    expect(checkFilePath('/../x')).toEqual({ reason: 'outside' })
    expect(checkFilePath('/data/x.sh')).toEqual({ reason: 'extension' })
  })
})

describe('path helpers', () => {
  it('splits a path the way the drive does', () => {
    expect(dirname('/data/reports/a.csv')).toBe('/data/reports')
    expect(dirname('/a.csv')).toBe('/')
    expect(basename('/data/reports/a.csv')).toBe('a.csv')
    expect(isRoot('/')).toBe(true)
    expect(isRoot('/a')).toBe(false)
  })
})
