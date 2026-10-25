@demo_target
Feature: Local demo fixture connection configuration
  The quick-start URI may name the same database as the explicit target.
  Safety restrictions still reject mismatched or unapproved destinations.

  @happy @edge
  Scenario Outline: Accept a loopback URI with an optional matching database
    Given a demo target URI "<uri>" and database "p2p_offgrid"
    When the demo connection safety guard runs
    Then the demo target is "accepted"

    Examples:
      | uri                                                                                  |
      | mongodb://127.0.0.1:27017/p2p_offgrid?replicaSet=rs0&directConnection=true              |
      | mongodb://localhost:27017/p2p_offgrid?replicaSet=rs0                                   |
      | mongodb://127.0.0.1:27017/?replicaSet=rs0                                               |

  @negative
  Scenario Outline: Reject unsafe or mismatched URI databases
    Given a demo target URI "<uri>" and database "<database>"
    When the demo connection safety guard runs
    Then the demo target is "rejected"

    Examples:
      | uri                                                   | database    |
      | mongodb://127.0.0.1:27017/p2p_offgrid_demo?replicaSet=rs0 | p2p_offgrid |
      | mongodb://127.0.0.1:27017/admin?replicaSet=rs0            | admin       |
      | mongodb://example.invalid:27017/p2p_offgrid              | p2p_offgrid |
      | mongodb://127.0.0.1:27017/p2p_offgrid/extra               | p2p_offgrid |
