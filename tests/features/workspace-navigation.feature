@wallet_setup_browser @workspace_navigation
Feature: Focused workspace navigation preserves ongoing work
  @happy @edge
  Scenario: Switching tasks preserves an unfinished transfer and supports browser history
    Given a real wallet setup browser for an "asset administrator"
    When I switch workspace tasks with an unfinished transfer
    Then browser Back restores the wallet with my transfer draft
    And reloading a bookmarked task opens only that task

  @negative @edge
  Scenario: An unknown bookmark falls back safely and sign-out removes the workspace
    Given a real wallet setup browser for an "asset administrator"
    When I open an unknown workspace bookmark
    Then only the wallet is visible and sign-out clears workspace navigation

  @happy @edge
  Scenario: Task navigation remains usable on a narrow screen with keyboard input
    Given a real wallet setup browser for an "asset administrator"
    When I navigate the workspace with a keyboard on a narrow screen
    Then all workspace tasks fit the viewport and the active task is announced

  @negative
  Scenario: Task navigation does not grant administration to an ordinary account
    Given a real wallet setup browser for a "new user"
    When I register and open wallet setup from the main navigation
    And I open administration from the focused workspace
    Then admin account setup explains the role grant requirement without offering bootstrap
