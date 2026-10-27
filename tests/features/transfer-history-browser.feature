@wallet_setup_browser @transfer_history_browser
Feature: Browser discovery uses real transfer history without local intent storage
  @happy @edge
  Scenario: Sign in again and recover the same admitted transfer and receipt
    Given a real wallet setup browser for an "asset administrator"
    When I admit a pending transfer through Send and sign in again with empty storage
    Then Activity discovers and checks the original pending transfer without another send
    When the original admitted transfer recovers
    Then the browser receipt matches one persisted financial effect
