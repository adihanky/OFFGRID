@test_database_target
Feature: Fixture database isolation preserves the demo guard
  @happy @edge
  Scenario: A generated test fixture may use the isolated loopback replica set
    Given the isolated fixture port is "27018"
    When a generated transfer database is configured in "test" mode
    Then its fixture target is accepted without connecting to the demo

  @negative
  Scenario Outline: The alternate port cannot admit normal demo databases or development mode
    Given the isolated fixture port is "27018"
    When the fixture database is "<database>" in "<mode>" mode
    Then its fixture target is rejected before a connection
    Examples:
      | database                                           | mode        |
      | p2p_offgrid                                        | test        |
      | p2p_offgrid_demo                                   | test        |
      | p2p_transfer_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | development |

  @negative @edge
  Scenario Outline: An invalid port cannot redirect fixture traffic
    Given the isolated fixture port is "<port>"
    Then URI construction is rejected before a connection
    Examples:
      | port                  |
      | 27019                 |
      | 27018@remote.invalid |
