# Unhinged Debt Collector Skill

## Description
The Unhinged Debt Collector Skill is responsible for collecting and managing the information needed to create a personalized debt reminder.

It guides the user through a structured debt form and collects details such as the person's name, Telegram username, amount owed, reason for the debt, how long it has been overdue, relationship to the user, whether they have been reminded before, the number of previous reminders, and any additional context.

The Skill stores this information as temporary session state and checks which required fields are still missing. It then returns a structured result describing the current state of the debt form so that the Agent can decide what to do next.

The Skill focuses only on **debt information collection and session state**. It does not send Telegram messages or control the Telegram communication layer. This separation allows the Agent to use the collected information for the next steps of the Unhinged Debt Collector workflow.
