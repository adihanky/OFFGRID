@wallet_setup_browser @enhancement_administration_browser
Feature: Guided enhancement administration uses real authorized APIs
  @happy @edge
  Scenario: Stale policy forms preserve edits and load the actual latest revision
    Given a real wallet setup browser for an "asset administrator"
    When two browser policy forms edit the same revision
    Then the stale form preserves its draft and compares current values
    And loading the latest settings permits a new audited publication

  @happy @edge
  Scenario: An explicit administrator decision credits a tracked consumer request once
    Given a real wallet setup browser for an "asset administrator"
    When a consumer allocation request reaches the browser review queue
    And I review and confirm its exact administrator decision
    Then the request and one balanced allocation persist even after replay

  @negative
  Scenario: Ordinary users cannot publish policies through screens or direct requests
    Given a real wallet setup browser for a "new user"
    When I register and open wallet setup from the main navigation
    And I open an administrator policy bookmark without its role
    Then policy publication stays unavailable and the direct API rejects it
