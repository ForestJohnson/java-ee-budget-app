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
			result = levelDb.snapshot(
					(db, readOptions) -> Arrays.toString(
								db.get("test".getBytes(), readOptions)
							)
					);
		} catch (IOException e) {
			result = "ERROR";
		}
		
		final String output = result + " :)";
		try {
			levelDb.atomicWrite(
				(writeBatch) -> writeBatch.put("test".getBytes(), output.getBytes())
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
