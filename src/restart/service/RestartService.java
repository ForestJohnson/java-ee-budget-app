package restart.service;

import java.io.IOException;
import java.util.Arrays;

import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

import restart.data.ILevelDB;
import restart.protobufs.Restart.*;

@Default
@Stateless
public class RestartService implements IRestartService {

  @Inject private ILevelDB levelDb;
  
  @Override
  public Test getData() {
    
    Test test;
	
    try {
      test = Test.parseFrom(
    		  levelDb.transaction( (db) -> db.get("test".getBytes()) )
    		 );
    } catch (Exception e) {
      test = Test.newBuilder().setGreeting("Error Getting").build();
    }
    
    final Test modified = Test.newBuilder(test)
    		.setGreeting(test.getGreeting() + " :) ")
    		.setTimesGreeted(test.getTimesGreeted() + 1)
    		.build();
    
    try {
      levelDb.transaction(
        (db) -> { db.put("test".getBytes(), modified.toByteArray()); return null; }
      );
    } catch (IOException e) {
      return Test.newBuilder().setGreeting("Error Setting").build();
    }
    
    return modified;
  }
  
  @Override
  public void close() throws Exception {
    // TODO Auto-generated method stub

  }
}
