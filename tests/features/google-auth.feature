@auth
Feature: Google OAuth sign-in
  As a peer
  I want to sign in with my verified Google identity
  So that I can access my Secure P2P account

  Background:
    Given an anonymous authentication browser

  @happy
  Scenario: A valid Google callback creates a verified session
    When I start Google sign-in
    Then Google authorization uses state, nonce and PKCE
    When I complete Google sign-in
    Then the Google callback succeeds
    When I read my authentication session
    Then the response status is 200
    And the public identity is "google@example.com" using "google"
    And credentials and session tokens are stored securely

  @negative
  Scenario Outline: Invalid Google tokens cannot create users or sessions
    Given Google returns "<problem>"
    When I start Google sign-in
    And I complete Google sign-in
    Then the Google callback fails with "google_failed"
    And there is exactly 0 stored user
    And no new authentication session is issued

    Examples:
      | problem          |
      | wrong signature  |
      | wrong audience   |
      | wrong issuer     |
      | expired          |
      | unverified email |
      | wrong nonce      |
      | missing token    |
      | provider failure |

  @negative
  Scenario Outline: The callback must match the browser and an unexpired flow
    When I start Google sign-in
    And the Google flow has "<problem>"
    And I complete Google sign-in
    Then the Google callback fails with "google_failed"
    And there is exactly 0 stored user

    Examples:
      | problem       |
      | wrong state   |
      | wrong browser |
      | expired state |

  @negative
  Scenario: Cancelling Google consent does not sign in
    When I start Google sign-in
    And I cancel Google sign-in
    Then the Google callback fails with "google_failed"
    And Google tokens were not requested

  @edge
  Scenario: A callback cannot be replayed
    When I start Google sign-in
    And I complete Google sign-in
    Then the Google callback succeeds
    When I replay the Google callback in a fresh browser
    Then the Google callback fails with "google_failed"
    And no new authentication session is issued
    And there is exactly 1 stored user

  @negative
  Scenario: Matching email does not automatically link Google to a password account
    Given a registered email account
    And Google uses the registered email
    When I start Google sign-in
    And I complete Google sign-in
    Then the Google callback fails with "account_exists"
    And there is exactly 1 stored user
    And the email account remains independent of Google

  @edge
  Scenario: Returning Google users keep the same identity
    When I start Google sign-in
    And I complete Google sign-in
    Then the Google callback succeeds
    When I start Google sign-in
    And I complete Google sign-in
    Then the Google callback succeeds
    And there is exactly 1 stored user

  @edge @google_disabled
  Scenario: Email authentication still works when Google is unconfigured
    When I inspect authentication providers
    Then Google sign-in is unavailable
    When I start Google sign-in without credentials
    Then the response status is 503
    When I register with email "alice@example.com" and handle "alice"
    Then the response status is 201
