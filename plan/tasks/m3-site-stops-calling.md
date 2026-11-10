## What
Change the test sites so the site never calls the service. A request to pay becomes a row the site writes and the service collects. A person who only watches gets a one-time sign-in link the service asks the site for.
## Why
One hosted bench can then serve every world, a laptop's devnet included, because the bench never needs to reach the service.
## Done when
- The end-to-end script passes with the site unable to reach the service.
