Feature - multi-branch workflow

After implementing the last feature - 015-lead-classification-revamp, i noticed a bug that's introduced. The personal accident - car accident workflow is getting triggered
for other case types as well. I entered case type as personal accident - assault charges but  the bot was asking me questions which are relevant to car accident case. 
Refer to negative-sop-flow.json to see the chat thread.

My expectation - The workflow should be multi-branch. Meaning that if i have not configured the questions for assualt charges explicility, it should skip the
case sub-type specific questions. The SOP is expected to be a multibranch workflow.
Another change i want to do is, move the when and contact sections above the case sub type questions.

So now the default SOP flow would be - 
1. case type
2. sub-type
3. where
4. what
5. when
6. contact
7. Trigger the multi-branch workflow according to the case type and sub-type.
8. As of now we have to configure a branch only for Personal Accident - Car Accident branch.
9. For the branches that are not configured. The workflow ends and leves the window open for any other questions the user might have.
9. I should have the option in admin dashboard to configure different branches and configure the lead score for the questions.


