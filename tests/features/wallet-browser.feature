@wallet_browser
Feature: Wallet form browser interaction
  Transfer details remain editable while assets are unavailable.
  Only an available asset permits review and confirmation.

  @edge
  Scenario Outline: Unavailable wallets explain the blocker without preventing typing
    Given a browser wallet with "<state>" assets
    When I type recipient and quantity in the wallet
    Then the browser wallet explains "<message>"
    And transfer review is disabled without sending a transfer

    Examples:
      | state    | message                                |
      | empty    | No assets are configured yet.          |
      | disabled | No assets are available for transfers. |
      | failed   | Unable to load balances.               |

  @happy
  Scenario: Type, review, edit and confirm a transfer in the browser
    Given a browser wallet with "active" assets
    When I type recipient and quantity in the wallet
    And I review and edit the browser transfer
    And I confirm the browser transfer
    Then the browser shows one completed transfer and the refreshed balance

  @negative
  Scenario: Invalid quantity leaves the form editable without looking up a peer
    Given a browser wallet with "active" assets
    When I type an invalid quantity and review the browser transfer
    Then the browser explains the quantity error without submitting

  @edge
  Scenario Outline: Balance refresh enables review and preserves typed details
    Given a browser wallet with "<state>" assets
    When I type recipient and quantity in the wallet
    And active assets become available and I refresh balances
    Then the typed browser details can be reviewed

    Examples:
      | state    |
      | empty    |
      | disabled |
      | failed   |

  @edge
  Scenario: Type transfer details while the wallet is still loading
    Given a browser wallet with "loading" assets
    When I type recipient and quantity in the wallet
    Then transfer review is disabled without sending a transfer
    When the browser balances finish loading
    Then the typed browser details can be reviewed

  @edge
  Scenario: A refreshed wallet replaces an asset that became disabled
    Given a browser wallet with "active" assets
    When I type recipient and quantity in the wallet
    And the selected asset becomes disabled and I refresh balances
    Then the typed browser details can be reviewed
