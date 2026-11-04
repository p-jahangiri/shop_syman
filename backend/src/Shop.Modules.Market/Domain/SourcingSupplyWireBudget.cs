using System.Text.Json;
using System.Text.Json.Serialization;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

public static class SourcingSupplyWireBudget
{
    public const int MaximumBytes=524288;
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){DefaultIgnoreCondition=JsonIgnoreCondition.WhenWritingNull,MaxDepth=16};
    // Page size is a maximum. A valid large Unicode entry must remain readable
    // rather than making every request for a fifty-entry page fail forever.
    public static TPage Page<TItem,TPage>(TItem[] found,int maximumItems,Func<TItem[],string?,TPage> envelope,Func<TItem,string> cursor)
    {
        if(maximumItems is <1 or >50||found.Length>maximumItems+1)throw new ArgumentOutOfRangeException(nameof(maximumItems));
        var count=Math.Min(found.Length,maximumItems);
        while(true){var items=found.Take(count).ToArray();var next=found.Length>count&&count>0?cursor(items[^1]):null;var result=envelope(items,next);if(JsonSerializer.SerializeToUtf8Bytes(result,Json).Length<=MaximumBytes)return result;if(count<=1)throw new BusinessException("sourcing_supply_capacity_unavailable","A supply entry exceeds its supported response bound.");count--;}
    }
}
