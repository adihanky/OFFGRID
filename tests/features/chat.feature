@chat
Feature: Participant-authorized persistent direct chat
  @happy @edge
  Scenario: Walletless peers exchange durable messages and recover duplicate sends
    Given an isolated chat with Alice Bob and a stranger
    When Alice and Bob open their direct chat concurrently
    And Alice sends the same chat message twice concurrently
    Then Bob sees one persisted message and one unread item
    And Bob can mark it read without changing financial data
    And the chat survives an API restart

  @negative @edge
  Scenario: Privacy validation and blocks protect the conversation
    Given an isolated chat with Alice Bob and a stranger
    When Alice and Bob open their direct chat concurrently
    Then strangers anonymous users and invalid writes cannot access chat
    And a changed duplicate body conflicts without another message
    And blocking prevents new sends while retaining prior history

  @happy @edge
  Scenario: Reconnect recovers an ordered gap larger than one page
    Given an isolated chat with Alice Bob and a stranger
    When Alice and Bob open their direct chat concurrently
    And Alice sends a chat gap larger than fifty messages
    Then Bob recovers the whole gap in order without duplicates

  @chat_browser @happy @negative @edge
  Scenario: Two browser sessions exchange messages and enforce a peer block
    Given an isolated chat with Alice Bob and a stranger
    When Alice and Bob chat through two real browser sessions
    Then a blocked peer cannot send and the browser chat survives reload
