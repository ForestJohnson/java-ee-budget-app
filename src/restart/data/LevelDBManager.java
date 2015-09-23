package restart.data;

import javax.annotation.PreDestroy;
import javax.ejb.Singleton;
import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import org.iq80.leveldb.*;
import static org.iq80.leveldb.impl.Iq80DBFactory.*;
import java.io.*;

@Singleton
@Stateless
@Default
public class LevelDBManager implements ILevelDBManager {

	private String fileName = "testLevelDb4";

	private DB db;
	
	private LevelDBManager () throws IOException {
		Options options = new Options();
		options.createIfMissing(true);
		options.compressionType(CompressionType.NONE);
		db = factory.open(new File(fileName), options);
		System.out.println("DB opened");
	}
	
	@Override
	public DB get() {
		return db;
	}
	
	@PreDestroy
	public void close() {
		System.out.println("DB closing");
		try {
			db.close();
		} catch (IOException e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		}
		System.out.println("DB closed");
	}
	
//	public <R> R snapshot(DB db, Function<ReadOptions, R> action) throws IOException {
//		ReadOptions readOptions = new ReadOptions();
//		readOptions.snapshot(db.getSnapshot());
//		try {
//			return action.apply(readOptions);
//		} finally {
//			// Make sure you close the snapshot to avoid resource leaks.
//			readOptions.snapshot().close();
//		}
//	}
//
//	public <R> R atomicWrite(DB db, Function<WriteBatch, R> action) throws IOException {
//		WriteBatch batch = db.createWriteBatch();
//		R result = action.apply(batch);
//		try {
//		} finally {
//			db.write(batch);
//			
//			// Make sure you close the batch to avoid resource leaks.
//			batch.close();
//		}
//		return result;
//	}

}


