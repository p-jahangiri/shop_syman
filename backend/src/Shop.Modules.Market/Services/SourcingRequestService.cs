using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.SharedKernel;

namespace Shop.Modules.Market;

public sealed class SourcingRequestService(MarketDbContext db,IMarketSourcingReader reader,ISourcingCart carts,ISourcingNoteProtection notes,TimeProvider clock,SourcingRequestOptions options,bool allowDemo,ISourcingPurchaseLifecycle? purchaseLifecycle=null)
{
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){UnmappedMemberHandling=JsonUnmappedMemberHandling.Disallow,MaxDepth=24};
    private sealed record PageCursor(long At,string Id,string Binding);
    private sealed record EventCursor(string After,string Binding);
    private IQueryable<SourcingRequest> Visible=>db.SourcingRequests.Where(r=>allowDemo||!r.ContainsDemo);
    private IQueryable<SourcingRequest> ForOwner(string? owner)=>owner is null?Visible:Visible.Where(r=>r.OwnerId==owner);
    private static string Reference(SourcingRequest row)=>"SR-"+row.Number.ToString(CultureInfo.InvariantCulture);
    private static bool Open(string state)=>state is "Submitted" or "Reviewing";
    private void RequireTransaction(){if(db.Database.CurrentTransaction?.GetDbTransaction().IsolationLevel!=IsolationLevel.Serializable)throw new InvalidOperationException("Sourcing commands require the root Serializable transaction shared with Sales and Catalog/Inventory.");}

    public async Task<SourcingMutationResult> SubmitAsync(string ownerId,string locale,SourcingSubmitInput supplied,CancellationToken ct)
    {
        var owner=SourcingRules.Actor(ownerId);SourcingRules.Locale(locale);var input=SourcingRules.Normalize(supplied);RequireTransaction();
        if(options.MaxOpenRequestsPerOwner is <1 or >1000)throw new InvalidOperationException("Configure a sourcing open-request technical cap from 1 to 1000.");
        var hash=SourcingRules.Payload(new{Locale=locale,input.CartVersion,input.Expected,input.Note});
        await LockAsync("owner:"+owner.ToUpperInvariant(),ct);await LockAsync("command:"+owner.ToUpperInvariant()+":submit:"+input.RequestId,ct);
        if(await ReplayAsync(owner,"submit",input.RequestId,hash,ct) is { } replay)return replay;
        var contents=await carts.ReadForSubmissionAsync(owner,ct);
        if(contents.CartId is null||contents.Version!=input.CartVersion)throw Conflict("The cart changed before request submission. Refresh both cart sections.");
        if(contents.Lines.Length is <1 or >24||contents.Lines.Any(l=>l.Quantity is <1 or >1000000)||contents.Lines.Select(l=>l.ListingId).Distinct(StringComparer.OrdinalIgnoreCase).Count()!=contents.Lines.Length)throw new BusinessException("invalid_sourcing_input","Submit a cart with 1 to 24 distinct sourcing selections.");
        var ids=contents.Lines.Select(l=>SourcingRules.Id(l.ListingId)).Order(StringComparer.Ordinal).ToArray();
        if(!ids.SequenceEqual(input.Expected.Select(e=>e.ListingId),StringComparer.Ordinal))throw Conflict("The expected selection differs from the cart.");
        if(await Visible.CountAsync(r=>r.OwnerId==owner&&(r.State=="Submitted"||r.State=="Reviewing"),ct)>=options.MaxOpenRequestsPerOwner)throw new BusinessException("sourcing_capacity_conflict","Review or cancel existing open sourcing requests before creating another.");
        var candidates=await reader.ReadConfiguredAsync(locale,ids,contents.Lines.Where(l=>l.ConfigurationId is not null).ToDictionary(l=>l.ListingId,l=>l.ConfigurationId!,StringComparer.OrdinalIgnoreCase),ct);var sourceRows=await db.Listings.AsNoTracking().Where(l=>ids.Contains(l.Id)).ToDictionaryAsync(l=>l.Id,StringComparer.OrdinalIgnoreCase,ct);
        var now=clock.GetUtcNow();var row=new SourcingRequest{OwnerId=owner,SubmitRequestId=input.RequestId,PayloadHash=hash,CartId=contents.CartId,SubmittedCartVersion=input.CartVersion,Locale=locale,State="Submitted",CreatedAt=now,ChangedAt=now};
        foreach(var expected in input.Expected){
            if(!candidates.TryGetValue(expected.ListingId,out var candidate)||candidate.Model is null||candidate.Fingerprint is null||candidate.Issue is not null||candidate.Model.HasAvailableStoreOffer)throw new BusinessException("sourcing_selection_conflict","A market model is unavailable for sourcing or is now available in the store. Review the cart.");
            if(candidate.Fingerprint!=expected.Fingerprint||!sourceRows.TryGetValue(expected.ListingId,out var source)||source.Status!="Published"||source.IsDemo&&!allowDemo)throw Conflict("A listing, specification or reference observation changed. Review the selection.");
            if(candidate.Configuration is null&&(candidate.Availability!=MarketRules.EffectiveAvailability(source.Availability,source.ValidUntil,now)||candidate.ReferencePriceCurrent!=(source.ReferencePriceRial.HasValue&&source.ValidUntil>now)))throw Conflict("The source observation expired during submission. Review the selection again.");
            SourcingSnapshots.Validate(candidate.Model);
            var quantity=contents.Lines.Single(l=>string.Equals(l.ListingId,expected.ListingId,StringComparison.OrdinalIgnoreCase)).Quantity;
            row.Lines.Add(Snapshot(row.Id,candidate,source,quantity,now));
        }
        row.ContainsDemo=row.Lines.Any(l=>l.IsDemo);row.ProtectedNote=notes.Protect(owner,row.Id,input.Note??"");
        if(row.ProtectedNote.Length is <1 or >32768)throw new BusinessException("sourcing_snapshot_limit","The protected note exceeds its supported bound.");
        // Reserve envelope space before the first INSERT. Oversized snapshots
        // never reach persistence, and no fields are silently truncated.
        if(JsonSerializer.SerializeToUtf8Bytes(new{Lines=row.Lines.Select(LineData).ToArray(),Note=input.Note},Json).Length>524288-8192)throw new BusinessException("sourcing_snapshot_limit","The request snapshot is too large. Split the selection into smaller requests.");
        db.SourcingRequests.Add(row);var ev=Event(row,owner,"customer",null,"request_submitted","",now);await db.SaveChangesAsync(ct);
        await carts.ConsumeSourcingAsync(owner,input.CartVersion,ct);
        return await RememberAsync(owner,"submit",input.RequestId,hash,row,ev,ct);
    }

    public async Task<SourcingRequestDetail> ReadAsync(string? ownerId,string id,CancellationToken ct)
    {
        var owner=ownerId is null?null:SourcingRules.Actor(ownerId);id=SourcingRules.Id(id);
        for(var attempt=0;attempt<2;attempt++){
            var row=await ForOwner(owner).AsNoTracking().Include(r=>r.Lines).ThenInclude(l=>l.Images).Include(r=>r.Lines).ThenInclude(l=>l.Attributes).ThenInclude(a=>a.Options).AsSplitQuery().SingleOrDefaultAsync(r=>r.Id==id,ct)??throw Missing();
            var version=await ForOwner(owner).AsNoTracking().Where(r=>r.Id==id).Select(r=>r.Version).SingleOrDefaultAsync(ct);
            if(version is null)throw Missing();if(!version.SequenceEqual(row.Version)){if(attempt==0)continue;throw Conflict("The request changed while being read. Refresh it.");}
            var result=new SourcingRequestDetail(1,Summary(row,row.Lines.Sum(l=>l.Quantity),row.Lines.Count,owner is null),notes.Unprotect(row.OwnerId,row.Id,row.ProtectedNote),row.Lines.OrderBy(l=>l.ListingId,StringComparer.Ordinal).Select(l=>LineData(l,owner is null)).ToArray(),owner is not null&&Open(row.State),owner is null&&row.State=="Submitted",owner is null&&Open(row.State));
            if(JsonSerializer.SerializeToUtf8Bytes(result,Json).Length>524288)throw new BusinessException("sourcing_snapshot_limit","The request detail exceeds its supported response bound.");return result;
        }
        throw new InvalidOperationException("Request read retry budget exhausted.");
    }

    public async Task<SourcingRequestPage> PageAsync(string? ownerId,string? state,string? query,string? cursor,CancellationToken ct)
    {
        var owner=ownerId is null?null:SourcingRules.Actor(ownerId);state??="all";if(state!="all"&&!SourcingRules.States.Contains(state,StringComparer.Ordinal))throw new BusinessException("invalid_sourcing_input","Use a known sourcing request state.");
        var filter=PurchaseAdminFilter.Create(query);var binding=filter.Binding("sourcing-requests:"+(owner??"admin")+":"+state);var after=Decode<PageCursor>(cursor);if(after is not null&&(after.Binding!=binding||after.Id is not {Length:32}||after.Id.Any(c=>c is not (>= '0' and <= '9' or >= 'a' and <= 'f'))||after.At<DateTimeOffset.MinValue.UtcTicks||after.At>DateTimeOffset.MaxValue.UtcTicks))throw InvalidCursor();
        var requests=ForOwner(owner).AsNoTracking();if(state!="all")requests=requests.Where(r=>r.State==state);
        foreach(var term in filter.Search.Split(' ',StringSplitOptions.RemoveEmptyEntries))requests=requests.Where(r=>r.Id.Contains(term)||("sr-"+r.Number.ToString()).Contains(term)||r.Lines.Any(l=>l.SearchText.Contains(term)));
        if(after is not null){var at=new DateTimeOffset(after.At,TimeSpan.Zero);requests=requests.Where(r=>r.CreatedAt<at||r.CreatedAt==at&&string.Compare(r.Id,after.Id)<0);}
        var size=owner is null?50:20;var found=await requests.OrderByDescending(r=>r.CreatedAt).ThenByDescending(r=>r.Id).Take(size+1).Select(r=>new{Row=r,Count=r.Lines.Sum(l=>l.Quantity),Lines=r.Lines.Count}).ToArrayAsync(ct);var page=found.Take(size).ToArray();
        return new(1,size,page.Select(p=>Summary(p.Row,p.Count,p.Lines,owner is null)).ToArray(),found.Length>size?Encode(new PageCursor(page[^1].Row.CreatedAt.UtcTicks,page[^1].Row.Id,binding)):null);
    }

    public async Task<SourcingRequestEventPage> EventsAsync(string? ownerId,string id,string? cursor,CancellationToken ct)
    {
        var owner=ownerId is null?null:SourcingRules.Actor(ownerId);id=SourcingRules.Id(id);if(!await ForOwner(owner).AsNoTracking().AnyAsync(r=>r.Id==id,ct))throw Missing();
        var binding=SourcingRules.Hash("sourcing-events:"+(owner??"admin")+":"+id);var after=Decode<EventCursor>(cursor);long position=0;
        if(after is not null&&(after.Binding!=binding||after.After is not {Length:>0 and <=19}||!long.TryParse(after.After,NumberStyles.None,CultureInfo.InvariantCulture,out position)||position<=0))throw InvalidCursor();
        var size=owner is null?50:20;var rows=await db.SourcingRequestEvents.AsNoTracking().Where(e=>e.RequestId==id&&e.Id>position).OrderBy(e=>e.Id).Take(size+1).ToArrayAsync(ct);var page=rows.Take(size).ToArray();
        return new(1,size,page.Select(e=>new SourcingRequestEventData(e.Id.ToString(CultureInfo.InvariantCulture),e.StateBefore,e.StateAfter,e.ActorKind,e.ReasonCode,e.PublicMessage,e.At)).ToArray(),rows.Length>size?Encode(new EventCursor(page[^1].Id.ToString(CultureInfo.InvariantCulture),binding)):null);
    }

    public Task<SourcingMutationResult> CancelAsync(string ownerId,string id,SourcingActionInput input,CancellationToken ct)=>TransitionAsync(SourcingRules.Actor(ownerId),ownerId,id,"cancel",input.RequestId,input.Version,"Cancelled","customer_cancelled","",ct);
    public Task<SourcingMutationResult> ReviewAsync(string actorId,string id,SourcingActionInput input,CancellationToken ct)=>TransitionAsync(SourcingRules.Actor(actorId),null,id,"review",input.RequestId,input.Version,"Reviewing","staff_review_started","",ct);
    public Task<SourcingMutationResult> UnavailableAsync(string actorId,string id,SourcingUnavailableInput input,CancellationToken ct)=>TransitionAsync(SourcingRules.Actor(actorId),null,id,"unavailable",input.RequestId,input.Version,"Unavailable",SourcingRules.Reason(input.ReasonCode),SourcingRules.Text(input.PublicMessage,500,true),ct);

    public async Task<SourcingMutationResult> ReadReceiptAsync(string actorId,string operation,string commandId,string? expectedTargetId,CancellationToken ct)
    {
        var actor=SourcingRules.Actor(actorId);var command=SourcingRules.CommandId(commandId);if(operation is not ("submit" or "cancel" or "review" or "unavailable"))throw new BusinessException("invalid_sourcing_input","Use a known sourcing command operation.");
        var target=expectedTargetId is null?null:SourcingRules.Id(expectedTargetId);
        var receipt=await db.SourcingCommandReceipts.AsNoTracking().SingleOrDefaultAsync(r=>r.ActorId==actor&&r.Operation==operation&&r.RequestId==command&&(target==null||r.TargetId==target),ct)??throw Missing();
        if(receipt.ContainsDemo&&!allowDemo)throw Missing();
        return (JsonSerializer.Deserialize<SourcingMutationResult>(receipt.ResultJson,Json)??throw new InvalidOperationException("The saved sourcing result is invalid.")) with{Replayed=true};
    }

    private async Task<SourcingMutationResult> TransitionAsync(string actor,string? owner,string id,string operation,string suppliedCommand,string suppliedVersion,string state,string reason,string message,CancellationToken ct)
    {
        id=SourcingRules.Id(id);var command=SourcingRules.CommandId(suppliedCommand);var version=SourcingRules.Version(suppliedVersion);if(owner is not null)SourcingRules.Actor(owner);RequireTransaction();
        var hash=SourcingRules.Payload(new{Target=id,Version=version,State=state,Reason=reason,PublicMessage=message});
        if(owner is not null)await LockAsync("owner:"+owner.ToUpperInvariant(),ct);
        await LockAsync("command:"+actor.ToUpperInvariant()+":"+operation+":"+command,ct);
        if(await ReplayAsync(actor,operation,command,hash,ct) is { } replay)return replay;
        await LockAsync("request:"+id,ct);var row=await ForOwner(owner).SingleOrDefaultAsync(r=>r.Id==id,ct)??throw Missing();
        if(Convert.ToBase64String(row.Version)!=version)throw new BusinessException("version_conflict","The sourcing request changed. Refresh it before changing its state.");
        if(!Open(row.State)||operation=="review"&&row.State!="Submitted")throw new BusinessException("sourcing_state_conflict","The request state does not allow this operation.");
        if(operation is "cancel" or "unavailable"){
            var now=clock.GetUtcNow();var kind=owner is null?"staff":"customer";var closeReason=operation=="cancel"?"request_cancelled":"request_unavailable";
            // Preserve the existing unexpired-acceptance fence. A legal close
            // then terminates any historical/open supply task atomically.
            await SourcingOfferLifecycle.BeforeParentCloseAsync(db,row.Id,actor,kind,closeReason,now,ct);
            await SourcingSupplyLifecycle.BeforeParentCloseAsync(db,row.Id,actor,kind,closeReason,now,ct,purchaseLifecycle);
        }
        var previous=row.State;row.State=state;row.ChangedAt=clock.GetUtcNow();db.Entry(row).Property(r=>r.ChangedAt).IsModified=true;var ev=Event(row,actor,owner is null?"staff":"customer",previous,reason,message,row.ChangedAt);await db.SaveChangesAsync(ct);
        return await RememberAsync(actor,operation,command,hash,row,ev,ct);
    }

    private async Task<SourcingMutationResult?> ReplayAsync(string actor,string operation,string command,string hash,CancellationToken ct)
    {
        var receipt=await db.SourcingCommandReceipts.AsNoTracking().SingleOrDefaultAsync(r=>r.ActorId==actor&&r.Operation==operation&&r.RequestId==command,ct);if(receipt is null)return null;
        if(receipt.ContainsDemo&&!allowDemo)throw Missing();if(receipt.PayloadHash!=hash)throw new BusinessException("idempotency_conflict","This sourcing command id was already used with a different payload.");
        return (JsonSerializer.Deserialize<SourcingMutationResult>(receipt.ResultJson,Json)??throw new InvalidOperationException("The saved sourcing result is invalid.")) with{Replayed=true};
    }
    private async Task<SourcingMutationResult> RememberAsync(string actor,string operation,string command,string hash,SourcingRequest row,SourcingRequestEvent ev,CancellationToken ct)
    {
        var result=new SourcingMutationResult(1,row.Id,Reference(row),row.State,Convert.ToBase64String(row.Version),ev.Id.ToString(CultureInfo.InvariantCulture),ev.At,false);
        var json=JsonSerializer.Serialize(result,Json);if(Encoding.Unicode.GetByteCount(json)>16384)throw new InvalidOperationException("Sourcing receipt exceeds the storage bound.");
        db.SourcingCommandReceipts.Add(new(){ActorId=actor,Operation=operation,RequestId=command,TargetId=row.Id,PayloadHash=hash,ResultJson=json,ContainsDemo=row.ContainsDemo,CreatedAt=clock.GetUtcNow()});await db.SaveChangesAsync(ct);return result;
    }
    private SourcingRequestEvent Event(SourcingRequest row,string actor,string kind,string? before,string reason,string message,DateTimeOffset at)
    {
        var ev=new SourcingRequestEvent{RequestId=row.Id,ActorId=actor,ActorKind=kind,StateBefore=before,StateAfter=row.State,ReasonCode=reason,PublicMessage=message,At=at};db.SourcingRequestEvents.Add(ev);return ev;
    }
    private static SourcingRequestSummary Summary(SourcingRequest row,int count,int lines,bool admin)=>new(row.Id,Reference(row),row.Locale,row.State,row.CreatedAt,row.ChangedAt,count,lines,Convert.ToBase64String(row.Version),row.ContainsDemo,admin?row.OwnerId:null);
    private static SourcingRequestLine Snapshot(string requestId,SourcingCandidate c,MarketListing source,int quantity,DateTimeOffset now)
    {
        var m=c.Model!;return new(){RequestId=requestId,ListingId=c.ListingId,ModelId=m.Id,Quantity=quantity,Slug=m.Slug,CategoryId=m.CategoryId,CategoryNameFa=m.CategoryNameFa,CategoryNameEn=m.CategoryNameEn,BrandId=m.BrandId,Brand=m.Brand,NameFa=m.NameFa,NameEn=m.NameEn,SearchText=PersianText.Normalize(m.NameFa+" "+m.NameEn+" "+m.Brand),DescriptionFa=m.DescriptionFa,DescriptionEn=m.DescriptionEn,ModelVersion=m.Version,ModelFingerprint=m.Fingerprint,ListingVersion=Convert.ToBase64String(source.Version),SelectionFingerprint=c.Fingerprint!,SourceKey=source.SourceKey,SourceItemKey=source.SourceItemKey,SourceNameFa=source.SourceNameFa,SourceNameEn=source.SourceNameEn,SourceUrl=source.SourceUrl,Availability=MarketRules.EffectiveAvailability(source.Availability,source.ValidUntil,now),ObservedAt=source.ObservedAt,ValidUntil=source.ValidUntil,ReferencePriceRial=source.ReferencePriceRial,ReferencePriceCurrent=source.ReferencePriceRial.HasValue&&source.ValidUntil>now,IsDemo=c.IsDemo,PhoneConfigurationJson=c.Configuration is null?null:JsonSerializer.Serialize(c.Configuration,Json),
            Images=m.Images.Select((url,index)=>new SourcingRequestImage{RequestId=requestId,ListingId=c.ListingId,SortOrder=index,Url=url}).ToList(),
            Attributes=m.Attributes.Select(a=>new SourcingRequestAttribute{RequestId=requestId,ListingId=c.ListingId,AttributeId=a.AttributeId,Key=a.Key,DataType=a.DataType,LabelFa=a.LabelFa,LabelEn=a.LabelEn,Unit=a.Unit,UnitFa=a.UnitFa,UnitEn=a.UnitEn,TextFa=a.TextFa,TextEn=a.TextEn,Number=a.Number,Bool=a.Bool,Options=a.Options.Select(o=>new SourcingRequestOption{RequestId=requestId,ListingId=c.ListingId,AttributeId=a.AttributeId,OptionId=o.Id,LabelFa=o.LabelFa,LabelEn=o.LabelEn}).ToList()}).ToList()};
    }
    private static SourcingRequestLineData LineData(SourcingRequestLine l)=>LineData(l,true);
    private static SourcingRequestLineData LineData(SourcingRequestLine l,bool admin)=>new(l.ListingId,l.Quantity,new(l.ModelId,l.Slug,l.CategoryId,l.CategoryNameFa,l.CategoryNameEn,l.BrandId,l.Brand,l.NameFa,l.NameEn,l.DescriptionFa,l.DescriptionEn,l.Images.OrderBy(i=>i.SortOrder).Select(i=>i.Url).ToArray(),l.ModelVersion,l.ModelFingerprint,false,l.Attributes.OrderBy(a=>a.Key,StringComparer.Ordinal).Select(a=>new SourcingAttributeSnapshot(a.AttributeId,a.Key,a.DataType,a.LabelFa,a.LabelEn,a.Unit,a.UnitFa,a.UnitEn,a.TextFa,a.TextEn,a.Number,a.Bool,a.Options.OrderBy(o=>o.OptionId,StringComparer.Ordinal).Select(o=>new SourcingOptionSnapshot(o.OptionId,o.LabelFa,o.LabelEn)).ToArray())).ToArray()),l.PhoneConfigurationJson is not null&&!admin?"درخواست تأمین گوشی":l.SourceNameFa,l.PhoneConfigurationJson is not null&&!admin?"Phone sourcing request":l.SourceNameEn,l.PhoneConfigurationJson is not null&&!admin?null:l.SourceUrl,l.PhoneConfigurationJson is not null&&!admin?"unknown":l.Availability,l.PhoneConfigurationJson is not null&&!admin?null:l.ObservedAt,l.PhoneConfigurationJson is not null&&!admin?null:l.ValidUntil,l.PhoneConfigurationJson is not null&&!admin?null:l.ReferencePriceRial?.ToString(CultureInfo.InvariantCulture),l.PhoneConfigurationJson is null||admin?l.ReferencePriceCurrent:false,l.IsDemo){Configuration=ReadPhoneConfiguration(l.PhoneConfigurationJson)};
    private static PhoneConfigurationSnapshot? ReadPhoneConfiguration(string? json)=>json is null?null:JsonSerializer.Deserialize<PhoneConfigurationSnapshot>(json,Json)??throw new BusinessException("phone_discovery_unavailable","The historical phone configuration is unavailable.");
    private static string Encode<T>(T value)=>Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(value,Json)).TrimEnd('=').Replace('+','-').Replace('/','_');
    private static T? Decode<T>(string? cursor) where T:class
    {
        if(cursor is null)return null;
        try{if(cursor.Length is <1 or >200||cursor.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not ('-' or '_')))throw InvalidCursor();var text=cursor.Replace('-','+').Replace('_','/');return JsonSerializer.Deserialize<T>(Convert.FromBase64String(text.PadRight((text.Length+3)/4*4,'=')),Json)??throw InvalidCursor();}
        catch(Exception e)when(e is FormatException or JsonException or ArgumentException){throw InvalidCursor();}
    }
    private async Task LockAsync(string key,CancellationToken ct)
    {
        var transaction=db.Database.CurrentTransaction??throw new InvalidOperationException("A sourcing application lock requires the root transaction.");await using var command=db.Database.GetDbConnection().CreateCommand();command.Transaction=transaction.GetDbTransaction();command.CommandTimeout=15;
        command.CommandText="DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result;";var parameter=command.CreateParameter();parameter.ParameterName="@resource";parameter.Value="sayman:market:sourcing:"+SourcingRules.Hash(key);command.Parameters.Add(parameter);
        if(Convert.ToInt32(await command.ExecuteScalarAsync(ct),CultureInfo.InvariantCulture)<0)throw new BusinessException("sourcing_busy_conflict","Another sourcing command is in progress. Retry the same command id.");
    }
    private static BusinessException Conflict(string message)=>new("sourcing_selection_conflict",message);
    private static BusinessException Missing()=>new("not_found","The sourcing request was not found.");
    private static BusinessException InvalidCursor()=>new("invalid_sourcing_cursor","Use the cursor belonging to this request, owner and filter.");
}
