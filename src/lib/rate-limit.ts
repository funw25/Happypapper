/**
 * 进程内滑动窗口限流。
 *
 * 用途是保护上游服务与自己：远程检索每个关键词会向上游发两个请求，OpenAlex 按
 * IP 限流，缓存未命中时的重复点击不应该变成重复的上游压力。限流只针对会打到
 * 上游的请求，命中缓存的请求不计数。
 *
 * 单进程内存实现与 docs/02-roadmap 的多实例部署目标不冲突：多实例时每个实例各
 * 自计数，限流变宽而不是失效，且上游仍有一道自己的闸门。
 */
type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function consume(
  key: string,
  options: { limit: number; windowMs: number },
): RateLimitDecision {
  const now = Date.now();
  const since = now - options.windowMs;
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((at) => at > since);

  if (bucket.hits.length >= options.limit) {
    const oldest = bucket.hits[0];
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  // Keep the map from growing without bound across a long-running server.
  if (buckets.size > 5000) {
    for (const [bucketKey, value] of buckets) {
      if (value.hits.every((at) => at <= since)) buckets.delete(bucketKey);
    }
  }

  return {
    allowed: true,
    remaining: options.limit - bucket.hits.length,
    retryAfterSeconds: 0,
  };
}
