Feature: Durable application wallets and compatible recipients
  A registered recipient can receive independently of active login sessions.

  Scenario: O02 Registration atomically provisions one empty application wallet
    Given an isolated application wallet fixture
    When a new user registers through the application
    Then exactly one active empty wallet belongs to the new user

  Scenario: O02 Concurrent duplicate registration cannot leave orphan wallets
    Given an isolated application wallet fixture
    When two requests register the same new identity concurrently
    Then one registration succeeds and one conflicts with no orphan wallet

  Scenario: O03 A logged-out registered peer resolves by handle and wallet
    Given an isolated application wallet fixture
    And two distinct registered application wallets with an enabled demo asset
    And the recipient has signed out
    When the sender resolves the recipient by exact handle and wallet ID
    Then both resolutions name the same compatible recipient without private fields

  Scenario: O03 Missing suspended self and unregistered destinations are unavailable
    Given an isolated application wallet fixture
    And two distinct registered application wallets with an enabled demo asset
    When the sender looks up unavailable and incompatible wallets
    Then each recipient lookup is unavailable with no resolution persisted

  Scenario: O03 Review expires before its TTL record is deleted
    Given an isolated application wallet fixture
    And two distinct registered application wallets with an enabled demo asset
    When the sender resolution expires while its record remains stored
    Then the review must be renewed

  Scenario: O09 Wallet resolution enforces authentication CSRF and sender ownership
    Given an isolated application wallet fixture
    And two distinct registered application wallets with an enabled demo asset
    When wallet resolution requests use invalid authentication CSRF or sender ownership
    Then the wallet security requests fail without persisting resolutions

  Scenario: O09 Role grants are checked live and never inferred from registration
    Given an isolated application wallet fixture
    And two distinct registered application wallets with an enabled demo asset
    When an auditor grant is added then revoked for the sender
    Then authorization permits only the active grant and rejects a disabled owner

  Scenario: O02 Revoking a binding retains lifetime address ownership
    Given an isolated application wallet fixture
    And two distinct registered application wallets with an enabled demo asset
    When the recipient binding is revoked and another wallet claims the same address
    Then binding uniqueness rejects reassignment and malformed wallet states
