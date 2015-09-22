package restart.data;

import java.io.IOException;
import java.util.function.BiFunction;
import java.util.function.Function;

import org.iq80.leveldb.DB;
import org.iq80.leveldb.DBIterator;
import org.iq80.leveldb.ReadOptions;
import org.iq80.leveldb.WriteBatch;

public interface ILevelDB extends AutoCloseable {
	
  public <R> R snapshot(BiFunction<DB, ReadOptions, R> action) throws IOException;
  public <R> R atomicWrite(Function<WriteBatch, R> action) throws IOException;
  public <R> R withIterator(DB db, ReadOptions readOptions, Function<DBIterator, R> action) throws IOException;

}
