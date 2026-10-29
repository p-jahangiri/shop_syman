using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Shop.SharedKernel;

public sealed class SourcingNoteProtection(IDataProtectionProvider provider):ISourcingNoteProtection
{
    private IDataProtector Protector(string ownerId,string requestId)=>provider.CreateProtector("Sayman.Sourcing.CustomerNote.v1",ownerId,requestId);
    public string Protect(string ownerId,string requestId,string note)=>Protector(ownerId,requestId).Protect(note);
    public string Unprotect(string ownerId,string requestId,string protectedNote)
    {
        try{return Protector(ownerId,requestId).Unprotect(protectedNote);}
        catch(CryptographicException){throw new BusinessException("sourcing_note_unavailable","The private note cannot be opened with the current identity key ring.");}
    }
}
