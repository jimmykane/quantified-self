-- Use finalized daily GA4 export tables. Pass @cutover and @as_of as TIMESTAMPs
-- and @stream as the production web stream ID. Change the dataset if exported elsewhere.
SELECT user_id AS uid, event_name AS name, FORMAT_TIMESTAMP('%FT%H:%M:%E6SZ', TIMESTAMP_MICROS(event_timestamp), 'UTC') AS at
FROM `quantified-self-io.analytics_211310222.events_*`
WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(DATE(@cutover), INTERVAL 1 DAY))
                         AND FORMAT_DATE('%Y%m%d', DATE_ADD(DATE(@as_of), INTERVAL 1 DAY))
  AND TIMESTAMP_MICROS(event_timestamp) BETWEEN @cutover AND @as_of
  AND user_id IS NOT NULL AND user_id != ''
  AND device.web_info.hostname = 'quantified-self.io' AND stream_id = @stream
  AND COALESCE(privacy_info.analytics_storage, 'Unset') != 'No'
  AND event_name IN ('onboarding_sync_selected', 'onboarding_analyze_selected', 'onboarding_compare_selected',
                     'recorded_workout_opened', 'comparison_result_opened')
