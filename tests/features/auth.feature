@auth
Feature: Email authentication and revocable sessions
  As a peer
  I want to register and sign in securely
  So that only I can use my account

  Background:
    Given an anonymous authentication browser

  @happy
  Scenario: Register, restore a session and sign out
    When I register with email " Alice@Example.COM " and handle " ALICE "
    Then the response status is 201
    And the public identity is "alice@example.com" using "email"
    And credentials and session tokens are stored securely
    When I read my authentication session
    Then the response status is 200
    And the public identity is "alice@example.com" using "email"
    When I sign out
    Then the response status is 204
    When I read my authentication session
    Then the response status is 401
    When I replay the previous session cookie
    Then the response status is 401

  @happy
  Scenario: Sign in to an existing email account
    Given a registered email account
    When I sign in with email "ALICE@EXAMPLE.COM" and password "correct horse battery"
    Then the response status is 200
    And the public identity is "alice@example.com" using "email"

  @negative
  Scenario Outline: Invalid credentials do not create a session
    Given a registered email account
    When I sign in with email "<email>" and password "<password>"
    Then the response status is 401
    And no new authentication session is issued

    Examples:
      | email               | password              |
      | alice@example.com   | wrong password        |
      | unknown@example.com | correct horse battery |

  @negative
  Scenario Outline: Duplicate identities are rejected
    Given a registered email account
    When I register a duplicate "<field>"
    Then the response status is 409
    And there is exactly 1 stored user

    Examples:
      | field        |
      | email        |
      | publicHandle |

  @negative
  Scenario Outline: Malformed registration data is rejected
    When I submit registration with "<problem>"
    Then the response status is 400
    And there is exactly 0 stored user

    Examples:
      | problem           |
      | invalid email     |
      | short password    |
      | long password     |
      | short handle      |
      | long handle       |
      | invalid handle    |
      | unknown field     |
      | object email      |

  @edge
  Scenario Outline: Exact password and handle boundaries are accepted
    When I register with password length <passwordLength> and handle length <handleLength>
    Then the response status is 201

    Examples:
      | passwordLength | handleLength |
      | 12             | 3            |
      | 128            | 24           |

  @negative
  Scenario Outline: Writes require a valid origin and CSRF token
    When I register with "<problem>" CSRF protection
    Then the response status is 403
    And there is exactly 0 stored user

    Examples:
      | problem        |
      | missing token  |
      | foreign origin |

  @edge
  Scenario: A forged double-submit token cannot sign out an authenticated browser
    When I register with email "alice@example.com" and handle "alice"
    Then the response status is 201
    When I sign out using a CSRF token from another session
    Then the response status is 403
    When I read my authentication session
    Then the response status is 200

  @negative
  Scenario: Anonymous users cannot read an identity
    When I read my authentication session
    Then the response status is 401

  @edge
  Scenario Outline: Expired, revoked and disabled sessions cannot authenticate
    When I register with email "alice@example.com" and handle "alice"
    Then the response status is 201
    Given the current authentication session is "<state>"
    When I read my authentication session
    Then the response status is 401

    Examples:
      | state    |
      | expired  |
      | revoked  |
      | disabled |

  @edge
  Scenario: Signing in rotates an existing session
    When I register with email "alice@example.com" and handle "alice"
    Then the response status is 201
    When I sign in with email "alice@example.com" and password "correct horse battery"
    Then the response status is 200
    When I replay the previous session cookie
    Then the response status is 401

  @negative
  Scenario: Repeated failed sign-ins are throttled
    Given a registered email account
    When I attempt 11 incorrect sign-ins
    Then the response status is 429

  @edge
  Scenario: Concurrent registration cannot create duplicate identities
    When two registrations race for the same email
    Then exactly one registration succeeds
    And there is exactly 1 stored user
