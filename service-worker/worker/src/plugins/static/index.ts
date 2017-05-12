import {
  cacheFromNetworkOp,
  copyExistingOrFetchOp,
  deleteCacheOp,
  fetchFromCacheInstruction,
  FetchInstruction,
  Operation,
  Plugin,
  PluginFactory,
  VersionWorker,
  LOG,
  Verbosity
} from '@angular/service-worker/worker';

interface UrlToHashMap {
  [url: string]: string;
}

interface StaticManifest {
  urls: UrlToHashMap;
  versioned?: string[];
}

export interface StaticContentCacheOptions {
  manifestKey?: string;
}

export function StaticContentCache(options?: StaticContentCacheOptions): PluginFactory<StaticContentCacheImpl> {
  const manifestKey = (options && options.manifestKey) || 'static';
  return (worker: VersionWorker) => new StaticContentCacheImpl(worker, manifestKey);
}

export class StaticContentCacheImpl implements Plugin<StaticContentCacheImpl> {
  private cacheKey: string;

  constructor(public worker: VersionWorker, public key: string) {
    this.cacheKey = key === 'static' ? key : `static:${key}`;
  }

  private get staticManifest(): StaticManifest {
    return this.worker.manifest[this.key];
  }

  private shouldCacheBustFn(): (url: string) => boolean {
    let shouldCacheBust = (url: string): boolean => true;
    if (!!this.staticManifest.versioned && Array.isArray(this.staticManifest.versioned)) {
      const regexes = this.staticManifest.versioned.map(expr => new RegExp(expr));
      shouldCacheBust = url => !regexes.some(regex => regex.test(url));
    }
    return shouldCacheBust;
  }

  setup(operations: Operation[]): void {
    const shouldCacheBust = this.shouldCacheBustFn();
    operations.push(...Object
      .keys(this.staticManifest.urls)
      .map(url => () => {
        return this
        .worker
        .cache
        .load(this.cacheKey, url)
        .then(resp => {
          if (!!resp) {
            LOG.technical(`setup(${this.cacheKey}, ${url}): no need to refresh ${url} in the cache`);
            return null;
          }
          LOG.technical(`setup(${this.cacheKey}, ${url}): caching from network`);
          return cacheFromNetworkOp(this.worker, url, this.cacheKey, shouldCacheBust(url))();
        })
      }
      ));
  }

  update(operations: Operation[], previous: StaticContentCacheImpl): void {
    const shouldCacheBust = this.shouldCacheBustFn();
    operations.push(...Object
      .keys(this.staticManifest.urls)
      .map(url => {
        const hash = this.staticManifest.urls[url];
        const previousHash = previous.staticManifest.urls[url];
        if (previousHash === hash) {
          LOG.technical(`update(${this.cacheKey}, ${url}): no need to refresh ${url} in the cache`);
          return copyExistingOrFetchOp(previous.worker, this.worker, url, this.cacheKey);
        } else {
          LOG.technical(`update(${this.cacheKey}, ${url}): caching from network`);
          return cacheFromNetworkOp(this.worker, url, this.cacheKey, shouldCacheBust(url));
        }
      })
    );
  }

  fetch(req: Request): FetchInstruction {
    return fetchFromCacheInstruction(this.worker, req, this.cacheKey);
  }

  cleanup(operations: Operation[]): void {
    operations.push(deleteCacheOp(this.worker, this.cacheKey));
  }

  validate(): Promise<boolean> {
    return Promise
      .all(Object
        .keys(this.staticManifest.urls)
        .map(url => this.worker.cache.load(this.cacheKey, url))
      )
      .then(resps => resps.every(resp => !!resp && resp.ok));
  }
}