# Agents

| Agent              | What it does                                      | Why                                                           | Takes information from | Interacts with                                         |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| **Main Agent**     | Talks to the agents and manages the overall process | Controls which agent works next                               | User                   | Debt Agent, Store Agent, Message Agent, Telegram Agent |
| **Debt Agent**     | Collects the debt information from the user       | Gets all the information needed for the debt reminder         | User                   | Main Agent, Store Agent                                |
| **Store Agent**    | Stores and retrieves the debt information         | Keeps the user's debt information available for the next step | Debt Agent             | Debt Agent, Message Agent                              |
| **Message Agent**  | Creates the actual debt reminder message          | Uses the stored information to write a personalized message   | Store Agent            | Main Agent                                             |
| **Telegram Agent** | Sends the approved message to the person          | Delivers the final message through Telegram                   | Main Agent             | Telegram                                               |

## Flow

**User → Main Agent → Debt Agent → Store Agent → Message Agent → Main Agent → Telegram Agent → Person**
