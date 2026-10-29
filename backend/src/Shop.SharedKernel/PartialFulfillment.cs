namespace Shop.SharedKernel;

// Private Inventory/Sales boundary. No price, carrier claim or customer-supplied stock.
// The caller owns Serializable and the canonical Sales owner lock before Inventory.
public sealed record PartialDispatchSelection(string LineKey,int Quantity,string[] UnitIds);
public sealed record PartialDispatchRequest(string OwnerId,string ReservationId,string ParcelId,string ActorId,string RequestId,string ExpectedFingerprint,PartialDispatchSelection[] Lines);
public sealed record PartialFulfillmentBalance(string LineKey,string VariantId,int Ordered,int Dispatched,int Remaining,string TrackingMode);
public sealed record PartialFulfillmentView(int SchemaVersion,string ReservationId,string OrderId,int ReservationContract,string Version,StockReservationState State,int DispatchCount,PartialFulfillmentBalance[] Lines,FulfillmentInventoryUnit[] RemainingUnits,string Fingerprint);
public sealed record PartialFulfillmentPlannedLine(string LineKey,string VariantId,int Quantity,string TrackingMode,string[] UnitIds);
public sealed record PartialFulfillmentMovement(string VariantId,int Quantity);
public sealed record PartialFulfillmentPlan(PartialFulfillmentPlannedLine[] Lines,PartialFulfillmentMovement[] Movements,bool CompletesReservation);
public sealed record PartialDispatchLineData(string LineKey,string VariantId,int Quantity,string TrackingMode,string MovementId);
public sealed record PartialDispatchData(int SchemaVersion,string ParcelId,int Sequence,string OwnerId,string ReservationId,string OrderId,int ReservationContract,string ActorId,string RequestId,string FingerprintBefore,string ReservationVersionAfter,StockReservationState StateAfter,DateTimeOffset RecordedAt,PartialDispatchLineData[] Lines,FulfillmentInventoryUnit[] Units,bool ContainsDemo,bool Replayed);
public interface IPartialOrderFulfillmentInventory
{
    Task<PartialFulfillmentView> ReadRemainingAsync(string ownerId,string reservationId,CancellationToken ct);
    Task<PartialDispatchData[]> ReadDispatchHistoryAsync(string ownerId,string reservationId,CancellationToken ct);
    Task<PartialDispatchData> DispatchAsync(PartialDispatchRequest request,CancellationToken ct);
}

public static class PartialFulfillmentRules
{
    public const int MaxDispatches=64,MaxLines=64,MaxTrackedUnits=100;
    public static PartialDispatchRequest Normalize(PartialDispatchRequest input)
    {
        if(input is null||input.Lines is not{Length:>0 and<=MaxLines}||input.Lines.Any(x=>x is null))throw Invalid();
        var selections=input.Lines.Select(x=>{
            var key=Identifier(x.LineKey);if(x.Quantity is<1 or>1000000||x.UnitIds is null||x.UnitIds.Length>MaxTrackedUnits)throw Invalid();
            var ids=x.UnitIds.Select(Id).Order(StringComparer.Ordinal).ToArray();return new PartialDispatchSelection(key,x.Quantity,ids);
        }).OrderBy(x=>x.LineKey,StringComparer.Ordinal).ToArray();
        var units=selections.SelectMany(x=>x.UnitIds).ToArray();if(units.Length>MaxTrackedUnits||units.Distinct(StringComparer.Ordinal).Count()!=units.Length||selections.Select(x=>x.LineKey).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=selections.Length)throw Invalid();
        return new(Identifier(input.OwnerId).ToUpperInvariant(),Id(input.ReservationId),Id(input.ParcelId),Identifier(input.ActorId).ToUpperInvariant(),Id(input.RequestId),Fingerprint(input.ExpectedFingerprint),selections);
    }
    public static PartialFulfillmentPlan Plan(PartialFulfillmentView view,PartialDispatchRequest supplied)
    {
        var input=Normalize(supplied);
        if(view is null||view.SchemaVersion!=1||view.ReservationContract is not(1 or 2)||view.Lines is not{Length:>0 and<=MaxLines}||view.RemainingUnits is null||view.RemainingUnits.Length>MaxTrackedUnits||view.DispatchCount is<0 or>MaxDispatches||view.Lines.Any(x=>x is null)||view.RemainingUnits.Any(x=>x is null))throw Unavailable();
        if(view.ReservationId!=input.ReservationId||view.State!=StockReservationState.Allocated)throw new BusinessException("partial_fulfillment_state_conflict","An allocated owned reservation is required.");
        if(view.DispatchCount==MaxDispatches)throw new BusinessException("partial_fulfillment_capacity_unavailable","The dispatch history capacity has been reached.");
        if(view.Fingerprint!=input.ExpectedFingerprint)throw new BusinessException("partial_fulfillment_version_conflict","The reviewed quantities or devices changed. Reload before dispatch.");
        if(view.Lines.Select(x=>x.LineKey).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=view.Lines.Length||view.Lines.Any(x=>x.Ordered is<1 or>1000000||x.Dispatched<0||x.Dispatched>x.Ordered||x.Remaining!=x.Ordered-x.Dispatched||x.TrackingMode is not("none"or"serial"or"imei")))throw Unavailable();
        foreach(var line in view.Lines){if(Identifier(line.LineKey)!=line.LineKey||Identifier(line.VariantId)!=line.VariantId)throw Unavailable();}
        if(view.Lines.Where(x=>x.TrackingMode!="none").Sum(x=>(long)x.Ordered)>MaxTrackedUnits)throw new BusinessException("partial_fulfillment_capacity_unavailable","The complete tracked device selection exceeds this workflow's capacity.");
        if(view.RemainingUnits.Select(x=>x.Id).Distinct(StringComparer.Ordinal).Count()!=view.RemainingUnits.Length||view.RemainingUnits.Any(u=>u.State!="assigned"||!view.Lines.Any(l=>l.LineKey==u.LineKey&&l.TrackingMode!="none"&&l.VariantId.Equals(u.VariantId,StringComparison.OrdinalIgnoreCase))))throw Unavailable();
        foreach(var line in view.Lines.Where(x=>x.TrackingMode!="none"))if(view.RemainingUnits.Count(x=>x.LineKey==line.LineKey)!=line.Remaining)throw new BusinessException("serial_assignment_required","Assign every tracked remaining device before beginning dispatch.");
        var result=new List<PartialFulfillmentPlannedLine>();
        foreach(var selection in input.Lines){var line=view.Lines.SingleOrDefault(x=>x.LineKey==selection.LineKey);if(line is null||selection.Quantity>line.Remaining)throw new BusinessException("partial_fulfillment_quantity_conflict","A selected line exceeds its remaining reserved quantity.");
            if(line.TrackingMode=="none"&&selection.UnitIds.Length!=0||line.TrackingMode!="none"&&selection.UnitIds.Length!=selection.Quantity)throw Invalid();
            if(selection.UnitIds.Any(id=>!view.RemainingUnits.Any(u=>u.Id==id&&u.LineKey==line.LineKey&&u.VariantId.Equals(line.VariantId,StringComparison.OrdinalIgnoreCase))))throw new BusinessException("partial_fulfillment_device_conflict","Select only the current assigned devices of this order line.");
            result.Add(new(line.LineKey,line.VariantId,selection.Quantity,line.TrackingMode,selection.UnitIds));
        }
        var movements=result.GroupBy(x=>x.VariantId,StringComparer.OrdinalIgnoreCase).Select(g=>{var quantity=g.Sum(x=>(long)x.Quantity);if(quantity>1000000)throw Unavailable();return new PartialFulfillmentMovement(g.Key,(int)quantity);}).OrderBy(x=>x.VariantId,StringComparer.Ordinal).ToArray();
        var completes=view.Lines.All(l=>l.Remaining==result.Where(x=>x.LineKey==l.LineKey).Sum(x=>x.Quantity));
        if(view.DispatchCount==MaxDispatches-1&&!completes)throw new BusinessException("partial_fulfillment_capacity_unavailable","The final allowed parcel must contain every remaining reserved item.");
        return new(result.ToArray(),movements,completes);
    }
    public static string Id(string? value){if(value is null||!Guid.TryParseExact(value,"N",out var id)||id==Guid.Empty||value!=id.ToString("N"))throw Invalid();return value;}
    public static string Identifier(string? value){if(value is null||value.Length is<1 or>64||value.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not('-'or'_')))throw Invalid();return value;}
    public static string Fingerprint(string? value){if(value is null||value.Length!=64||value.Any(c=>!char.IsAsciiHexDigit(c)))throw Invalid();return value.ToUpperInvariant();}
    public static BusinessException Invalid()=>new("invalid_partial_fulfillment","Use a bounded exact selection of lines and assigned devices.");
    public static BusinessException Unavailable()=>new("partial_fulfillment_unavailable","The remaining reservation facts could not be verified.");
}
