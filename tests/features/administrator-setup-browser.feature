@wallet_setup_browser @administrator_setup
Feature: Administrator account setup is discoverable and remains authorized
  @happy @negative @edge
  Scenario: A new installation enables its first administrator with a one-use token
    Given a real wallet setup browser for a "first administrator"
    When I create an account through the administrator setup entry
    And I submit an invalid installation token then the valid setup token
    Then the new account has persisted administrator access and the setup token is cleared

  @negative @edge
  Scenario: Registration cannot become administrator on an already configured installation
    Given a real wallet setup browser for a "new user"
    When I create an account through the administrator setup entry
    Then admin account setup explains the role grant requirement without offering bootstrap

  @happy
  Scenario: An access administrator can find the existing role-grant controls
    Given a real wallet setup browser for an "asset administrator"
    When I open administrator account management from the main navigation
    Then the Access form is visible for granting another registered account administrator roles
