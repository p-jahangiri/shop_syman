using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Shop.Modules.Market;
using Shop.SharedKernel;

public sealed class SourcingSupplyNoteProtection(IDataProtectionProvider provider):ISourcingSupplyNoteProtection
{
    private IDataProtector Protector(string ownerId,string taskId)=>provider.CreateProtector("Sayman.Sourcing.SupplyInternalNote.v1",ownerId,taskId);
    public string Protect(string ownerId,string taskId,string note)=>Protector(ownerId,taskId).Protect(note);
    public string Unprotect(string ownerId,string taskId,string protectedNote)
    {
        try{return Protector(ownerId,taskId).Unprotect(protectedNote);}
        catch(CryptographicException){throw new BusinessException("sourcing_supply_note_unavailable","The internal supply note cannot be opened with the current identity key ring.");}
    }
}
