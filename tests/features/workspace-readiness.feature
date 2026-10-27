@consumer_requests @workspace_readiness
Feature: Home suggests an action the consumer can use
  @negative @edge
  Scenario: A funded suspended wallet points to Help instead of Send
    Given an isolated consumer request fixture
    When the funded consumer wallet is suspended
    Then the workspace offers Help and explains operator attention
