@wallet_setup_browser @wallet_view
Feature: Network wallets are the default with an explicit legacy switch
  @happy @negative
  Scenario: Default wallet view hides legacy balances and preferences
    Given a real wallet setup browser for an "asset administrator"
    When I reload the Wallet task without selecting legacy wallets
    Then network wallets are selected and legacy controls are absent
    When I select legacy wallets in the wallet display options
    Then legacy balances are available and network controls are hidden

  @happy @edge
  Scenario: Switching views preserves a legacy draft and remains keyboard accessible
    Given a real wallet setup browser for an "asset administrator"
    When I change wallet views with a legacy draft on a narrow screen
    Then the draft is retained and reloading returns to network wallets

  @negative @edge
  Scenario: Signing out discards the legacy display selection
    Given a real wallet setup browser for an "asset administrator"
    When I sign out after selecting legacy wallets and register a new wallet viewer
    Then the new wallet viewer starts with network wallets
