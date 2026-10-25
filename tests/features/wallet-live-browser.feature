@wallet_live_browser
Feature: Wallet browser uses real API and isolated MongoDB data
  @happy
  Scenario: Configure an asset and pay a logged-out registered peer in the browser
    Given a browser connected to an isolated real wallet service
    When I register and enable administration in the browser
    And I create and activate a demo asset and issue 100.00 units in the browser
    And I review and send 12.50 units to the logged-out peer in the browser
    Then the real wallet balances, ledger, transfer chain and custody agree
    And I can manage access, inspect audit and run demo data in the browser

  @negative @edge
  Scenario: Real browser rejects unknown recipients and insufficient funds
    Given a browser connected to an isolated real wallet service
    When I register and enable administration in the browser
    And I create and activate a demo asset and issue 100.00 units in the browser
    And I try an unknown recipient and then overspend in the browser
    Then no payment commits and my form can start another transfer

  @edge
  Scenario: Expired server review returns the browser to an editable form
    Given a browser connected to an isolated real wallet service
    When I register and enable administration in the browser
    And I create and activate a demo asset and issue 100.00 units in the browser
    And the recipient review expires on the server before browser confirmation
    Then the browser requests a fresh review without creating a payment
