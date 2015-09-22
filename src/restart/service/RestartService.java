package restart.service;

import java.io.IOException;
import java.util.Arrays;

import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

import restart.data.ILevelDB;

@Default
@Stateless
public class RestartService implements IRestartService {

  @Inject private ILevelDB levelDb;
  
  @Override
  public String getData() {
    
    String result = "";
    try {
      result = levelDb.transaction(
          (db) -> {
                byte[] resultBytes = db.get("test".getBytes());
                return resultBytes != null && resultBytes.length > 0 ? new String(resultBytes) : "";
             }
          );
    } catch (IOException e) {
      result = "ERROR";
    }
    
    final String output = result + " :)";
    try {
      levelDb.transaction(
        (db) -> { db.put("test".getBytes(), output.getBytes()); return null;}
      );
    } catch (IOException e) {
      return "WRITE ERROR";
    }
    
    return output;
  }
  
  @Override
  public void close() throws Exception {
    // TODO Auto-generated method stub

  }
}
