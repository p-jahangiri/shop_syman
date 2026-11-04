namespace Shop.SharedKernel;
// Post-commit invalidation only; persisted messages/notifications remain module-owned SQL data.
public interface IPrivateRealtimeEvents
{
    void SupportChanged(string owner);
    void InboxChanged(string owner);
}
