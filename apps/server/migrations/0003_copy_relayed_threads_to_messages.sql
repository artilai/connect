-- A message the Message URL relayed kept its sender's thread only on the event the recipient got.
-- The sender's copy keeps it now, so an answer to the message still wakes that thread.
UPDATE `messages` SET `client_thread` = (
  SELECT `events`.`thread` FROM `events`
  WHERE `events`.`message_id` = `messages`.`external_id`
    AND json_extract(`events`.`sender`, '$.id') = `messages`.`account_id`
)
WHERE `channel` = 'url' AND `direction` = 'outbound' AND `client_thread` IS NULL;
