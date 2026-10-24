@health
Feature: API health
  As an operator
  I want accurate liveness and database readiness responses
  So that traffic is sent only to an API that can serve it

  @happy
  Scenario: A running API identifies itself
    Given MongoDB is "ready"
    When I request GET "/api/health/live"
    Then the response status is 200
    And the live service is "p2p-api"

  @happy
  Scenario: A writable database in the configured replica set is ready
    Given MongoDB is "ready"
    When I request GET "/api/health/ready"
    Then the response status is 200
    And the readiness status is "ready"
    And the readiness checks report MongoDB "up" and replica set "ready"

  @negative
  Scenario Outline: An unsuitable database cannot receive traffic
    Given MongoDB is "<condition>"
    When I request GET "/api/health/ready"
    Then the response status is 503
    And the readiness status is "unavailable"
    And the readiness checks report MongoDB "<mongodb>" and replica set "unavailable"
    And the response does not reveal private driver errors

    Examples:
      | condition           | mongodb |
      | unreachable         | down    |
      | wrong replica set   | up      |
      | no writable primary | up      |

  @edge
  Scenario Outline: Missing or malformed transaction session support prevents readiness
    Given MongoDB is "<condition>"
    When I request GET "/api/health/ready"
    Then the response status is 503
    And the readiness checks report MongoDB "up" and replica set "unavailable"

    Examples:
      | condition               |
      | missing session support |
      | invalid session support |

  @edge
  Scenario: Database failure does not make the API process dead
    Given MongoDB is "unreachable"
    When I request GET "/api/health/live"
    Then the response status is 200
    And the live service is "p2p-api"

  @edge
  Scenario: Readiness recovers after a database outage
    Given MongoDB is "unreachable"
    When I request GET "/api/health/ready"
    Then the response status is 503
    When MongoDB becomes "ready"
    And I request GET "/api/health/ready"
    Then the response status is 200
    And the readiness checks report MongoDB "up" and replica set "ready"

  @negative
  Scenario: Unknown health routes return not found
    Given MongoDB is "ready"
    When I request GET "/api/health/unknown"
    Then the response status is 404
