/** Fixed SQL projections for disjoint bot/non-bot contributions to report totals. */
export function withTrafficBreakdown(name: string, statement: string): string {
  if (name === 'unique-visitors') {
    return statement
      .replace(
        'count(DISTINCT visitor_key) AS daily_unique_visitors',
        'count(DISTINCT visitor_key) AS daily_unique_visitors, count(DISTINCT visitor_key) FILTER (WHERE NOT coalesce(is_bot, false)) AS non_bot',
      )
      .replace(
        'SELECT day,\n       daily_unique_visitors,',
        'SELECT day,\n       daily_unique_visitors, non_bot, daily_unique_visitors - non_bot AS bot,',
      );
  }
  if (name === 'cache-hit-ratio') {
    return statement
      .replace(
        'AS cache_hits\n',
        "AS cache_hits, count(*) FILTER (WHERE result_type IN ('Hit', 'RefreshHit') AND coalesce(is_bot, false)) AS bot_hits\n",
      )
      .replace(
        'AS cache_hit_ratio\n',
        'AS cache_hit_ratio, CAST(bot_hits AS DOUBLE) / requests AS bot, CAST(cache_hits - bot_hits AS DOUBLE) / requests AS non_bot\n',
      );
  }
  const projection = name === 'row-count' ? 'count(*) AS row_count' : 'count(*) AS views';
  return statement.replace(
    projection,
    `${projection}, count(*) FILTER (WHERE coalesce(is_bot, false)) AS bot, count(*) FILTER (WHERE NOT coalesce(is_bot, false)) AS non_bot`,
  );
}
