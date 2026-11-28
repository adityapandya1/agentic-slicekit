## Problem and who has it

Any team working with a AI driven software factory uses a bunch of models. There is always a challenge in picking which set of models work best for them and that is what we should solve for.

## What they do today

I think it is based on a lot of intuition and trial and error. Explore models for different tasks and then end up using whatever, and each develop then has their own way of working. With this we can standardise across the team and suggest this is the most effificient model for this particular task. At the end of the day the model used by agents are confugurable and so the developer can still choose their thing but with this utility atleast we give them the benchmarking and suggest the best model for each thing.

## Use cases

anyone who is working on the project can do it. You store a report of benchmarking with numbers in the repo and keep updating as and when benchmarking is triggered for a new model manually by someone using slicekit

All three: (1) a team chooses slicekit for their greenfield project; they can configure which model to be used by each agent - tester, developer, reviewer, audit etc. - run the benchmarking utility and based on the result set those models for each agent/work. (2) as new models are coming every other month, slicekit can look at the new model and see whether it is better to use this or not. (3) the model used by agents are configurable, so the developer can still choose their thing.

## Out of scope

## Success measures

I would want to see a comparison matrix against models and what kind of task was this evaluated on. Time taken, number of token, reviews required after the completion of task, if coding related then quality of the code.

## Constraints

That is also one of the metric. How much time each model takes (and iteration) to deliver the same quality. Based on that we can figure out what should be the constraints.

## Open questions

Out of scope

I am still not sure how the evaluation be done and what task to pick for the evaluation. Maybe in an ideal case where the team is running slicekit would first start with a project and once the planning is done and phases are built, from the phases slicekit suggest which slice to do benchmarking with and set the models after.
