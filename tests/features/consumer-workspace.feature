@wallet_setup_browser @consumer_workspace
Feature: Consumer tasks preserve control and editable drafts
  @happy
  Scenario: Home gives an unfunded existing user a useful next action
    Given a real wallet setup browser for an "asset administrator"
    When I open the consumer Home task
    Then Home explains demo readiness and receiving without external wallet setup

  @happy @edge
  Scenario: Saving settings and reloading cannot discard an unrelated send draft
    Given a real wallet setup browser for an "asset administrator"
    When I save wallet settings while a send draft is unfinished
    Then the editable send draft survives settings, Back and reload

  @negative @edge
  Scenario: A fresh account cannot inherit another identity's draft
    Given a real wallet setup browser for an "asset administrator"
    When I sign out with an editable send draft and register another consumer
    Then the new identity has an empty draft and useful Home navigation
