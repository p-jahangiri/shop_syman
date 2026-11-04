using System.Security.Cryptography;
using System.Text;
using Shop.SharedKernel;
namespace Shop.Modules.Files;

public interface IPrivateFileProtection
{
    byte[] Protect(string purpose,byte[] value);
    byte[] Unprotect(string purpose,byte[] value);
}
public sealed record PrivateFileEnvelope(byte[] Bytes,byte[] ProtectedKey,byte[] ProtectedFilename);
public sealed class PrivateFileCrypto(IPrivateFileProtection protection)
{
    private static string Purpose(PrivateFileScope scope,string id,string kind)=>string.Join(':',"Sayman.PrivateFiles.v1",scope.Kind,scope.ResourceId,scope.OwnerId,id,kind);
    public string Filename(PrivateFileScope scope,string id,byte[] protectedFilename)
    {
        scope=PrivateFileRules.Scope(scope);PrivateFileRules.Id(id);try{return PrivateFileRules.Filename(new UTF8Encoding(false,true).GetString(protection.Unprotect(Purpose(scope,id,"name"),protectedFilename)));}catch(Exception e)when(e is CryptographicException or DecoderFallbackException or BusinessException){throw PrivateFileRules.Unavailable();}
    }
    public PrivateFileEnvelope Encrypt(PrivateFileScope scope,string id,string payloadHash,string filename,byte[] plaintext)
    {
        scope=PrivateFileRules.Scope(scope);PrivateFileRules.Id(id);PrivateFileRules.Filename(filename);
        var key=RandomNumberGenerator.GetBytes(32);try{var nonce=RandomNumberGenerator.GetBytes(12);var bytes=EncryptBytes(key,nonce,payloadHash,plaintext);return new(bytes,protection.Protect(Purpose(scope,id,"key"),key),protection.Protect(Purpose(scope,id,"name"),Encoding.UTF8.GetBytes(filename)));}finally{CryptographicOperations.ZeroMemory(key);}
    }
    public byte[] Recreate(PrivateFileScope scope,string id,string payloadHash,byte[] protectedKey,byte[] nonce,byte[] plaintext)
    {
        scope=PrivateFileRules.Scope(scope);PrivateFileRules.Id(id);var key=OpenKey(scope,id,protectedKey);try{return EncryptBytes(key,nonce,payloadHash,plaintext);}finally{CryptographicOperations.ZeroMemory(key);}
    }
    public PrivateFileDownload Decrypt(PrivateFileScope scope,string id,string payloadHash,byte[] protectedKey,byte[] protectedFilename,string contentType,byte[] envelope,int expectedBytes)
    {
        scope=PrivateFileRules.Scope(scope);PrivateFileRules.Id(id);if(expectedBytes is <16 or >PrivateFileRules.MaxBytes||envelope.Length!=expectedBytes+PrivateFileRules.EnvelopeOverhead||!envelope.AsSpan(0,4).SequenceEqual("SPF1"u8))throw PrivateFileRules.Unavailable();
        var key=OpenKey(scope,id,protectedKey);var plain=new byte[expectedBytes];try{using var aes=new AesGcm(key,16);aes.Decrypt(envelope.AsSpan(4,12),envelope.AsSpan(32),envelope.AsSpan(16,16),plain,Associated(payloadHash));var name=new UTF8Encoding(false,true).GetString(protection.Unprotect(Purpose(scope,id,"name"),protectedFilename));PrivateFileRules.Content(name,contentType,plain);return new(name,contentType,plain);}catch(Exception e)when(e is CryptographicException or DecoderFallbackException or BusinessException){CryptographicOperations.ZeroMemory(plain);throw PrivateFileRules.Unavailable();}finally{CryptographicOperations.ZeroMemory(key);}
    }
    private byte[] OpenKey(PrivateFileScope scope,string id,byte[] value){try{var key=protection.Unprotect(Purpose(scope,id,"key"),value);if(key.Length==32)return key;CryptographicOperations.ZeroMemory(key);throw PrivateFileRules.Unavailable();}catch(CryptographicException){throw PrivateFileRules.Unavailable();}}
    private static byte[] Associated(string hash){if(hash.Length!=64||hash.Any(c=>!char.IsAsciiHexDigitUpper(c)))throw PrivateFileRules.Unavailable();return Encoding.ASCII.GetBytes("Sayman.PrivateFile.v1:"+hash);}
    private static byte[] EncryptBytes(byte[] key,byte[] nonce,string hash,byte[] plain)
    {
        if(key.Length!=32||nonce.Length!=12||plain.Length is <16 or >PrivateFileRules.MaxBytes)throw PrivateFileRules.Unavailable();var result=new byte[plain.Length+32];"SPF1"u8.CopyTo(result);nonce.CopyTo(result,4);using var aes=new AesGcm(key,16);aes.Encrypt(nonce,plain,result.AsSpan(32),result.AsSpan(16,16),Associated(hash));return result;
    }
}
